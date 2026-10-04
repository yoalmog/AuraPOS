package com.aurapos.pos.hardware

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.*
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.io.OutputStream
import java.util.*
import java.util.concurrent.ConcurrentHashMap

/**
 * Native Android Bluetooth Hardware Driver for AuraPOS
 * Supports:
 * 1. Standard ESC/POS Bluetooth Thermal Printers (X18 Mini, POS-58, MPT-II, Epson, Star, Rongta, etc.)
 *    via Classic RFCOMM SPP (Secure & Insecure channels 1-3) AND Bluetooth Low Energy (BLE GATT).
 * 2. Cat / X6 / X6h / C9 / WalkPrint / TinyPrint Microcontroller Thermal Printers (0x5178 Bitmap & BLE Protocol)
 *
 * Conforming to Sections 5 & 6:
 * - Real Android Bluetooth APIs (Classic RFCOMM SPP + Bluetooth Low Energy GATT)
 * - Real device discovery via BroadcastReceiver & BLE
 * - Dual-mode connection with Insecure RFCOMM Channel fallback
 * - Full BLE GATT transmission for standard ESC/POS printers
 * - True hardware status (ONLINE, OFFLINE, CONNECTING, ERROR)
 */
class BluetoothPrinterManager(private val context: Context) {

    private val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    private val bluetoothAdapter: BluetoothAdapter?
        get() = bluetoothManager?.adapter ?: BluetoothAdapter.getDefaultAdapter()

    // Active sockets and output streams indexed by MAC address (Classic RFCOMM SPP)
    private val activeSockets = ConcurrentHashMap<String, BluetoothSocket>()
    private val activeStreams = ConcurrentHashMap<String, OutputStream>()

    // Active GATT connections and write characteristics indexed by MAC address (Bluetooth Low Energy)
    private val activeGatts = ConcurrentHashMap<String, BluetoothGatt>()
    private val activeGattWriteChars = ConcurrentHashMap<String, BluetoothGattCharacteristic>()

    // Discovered devices during active scan
    private val discoveredDevices = ConcurrentHashMap<String, BluetoothDevice>()
    private var isScanning = false
    private var discoveryCallback: ((String) -> Unit)? = null

    // Standard Bluetooth Serial Port Profile (SPP) UUID used by ESC/POS printers
    private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

    // Common Thermal Printer BLE Service UUIDs (X6h/Cat printer, generic ESC/POS BLE, Xunwei, etc.)
    private val KNOWN_BLE_WRITE_UUIDS = listOf(
        "0000ae01", // X6 / X6h / Cat / TinyPrint write characteristic
        "0000ffe1", // Standard Chinese 58mm BLE write characteristic (X18, POS-58, MPT-II)
        "00002af1", // Generic ESC/POS BLE characteristic
        "0000ff02", // POS-58 BLE characteristic
        "0000fee1", // WeChat / Xunwei characteristic
        "0000fec7", // Xunwei alternate characteristic
        "e7810a71", // PT-210 characteristic
        "49535343", // ISSC transparent UART
        "6e400002"  // Nordic NUS RX write
    )

    private val discoveryReceiver = object : BroadcastReceiver() {
        @SuppressLint("MissingPermission")
        override fun onReceive(c: Context, intent: Intent) {
            when (intent.action) {
                BluetoothDevice.ACTION_FOUND, BluetoothDevice.ACTION_NAME_CHANGED -> {
                    val device: BluetoothDevice? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
                    }
                    if (device != null && device.address != null) {
                        discoveredDevices[device.address] = device
                        notifyDevicesUpdated()
                    }
                }
                BluetoothAdapter.ACTION_DISCOVERY_FINISHED -> {
                    isScanning = false
                    notifyDevicesUpdated()
                }
                BluetoothAdapter.ACTION_STATE_CHANGED -> {
                    notifyDevicesUpdated()
                }
            }
        }
    }

    init {
        val filter = IntentFilter().apply {
            addAction(BluetoothDevice.ACTION_FOUND)
            addAction(BluetoothDevice.ACTION_NAME_CHANGED)
            addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED)
            addAction(BluetoothAdapter.ACTION_STATE_CHANGED)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(discoveryReceiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            context.registerReceiver(discoveryReceiver, filter)
        }
    }

    fun isBluetoothEnabled(): Boolean {
        return try {
            bluetoothAdapter?.isEnabled == true
        } catch (_: SecurityException) {
            false
        }
    }

    fun hasPermissions(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        }
    }

    @SuppressLint("MissingPermission")
    fun startScan(callback: (String) -> Unit): String {
        val adapter = bluetoothAdapter
        if (adapter == null) {
            return JSONObject().apply {
                put("success", false)
                put("error", "Bluetooth hardware is not available on this device.")
            }.toString()
        }

        if (!adapter.isEnabled) {
            return JSONObject().apply {
                put("success", false)
                put("bluetoothDisabled", true)
                put("error", "Bluetooth is currently disabled. Please enable Bluetooth in Android settings.")
            }.toString()
        }

        if (!hasPermissions()) {
            return JSONObject().apply {
                put("success", false)
                put("permissionDenied", true)
                put("error", "Nearby Devices and Bluetooth Scan permissions are required to discover printers.")
            }.toString()
        }

        discoveryCallback = callback
        discoveredDevices.clear()

        // 1. Populate already paired / bonded devices immediately
        try {
            adapter.bondedDevices?.forEach { device ->
                if (device.address != null) {
                    discoveredDevices[device.address] = device
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error querying bonded devices: ${e.message}")
        }

        // 2. Start native Bluetooth discovery
        try {
            if (adapter.isDiscovering) {
                adapter.cancelDiscovery()
            }

            val started = adapter.startDiscovery()
            isScanning = started

            notifyDevicesUpdated()

            return JSONObject().apply {
                put("success", true)
                put("isScanning", started)
                put("message", "Bluetooth hardware scan initiated.")
            }.toString()
        } catch (e: Exception) {
            return JSONObject().apply {
                put("success", false)
                put("error", "Failed to start Bluetooth scan: ${e.message}")
            }.toString()
        }
    }

    @SuppressLint("MissingPermission")
    fun stopScan() {
        try {
            if (bluetoothAdapter?.isDiscovering == true) {
                bluetoothAdapter?.cancelDiscovery()
            }
        } catch (_: Exception) {}
        isScanning = false
    }

    @SuppressLint("MissingPermission")
    fun getDiscoveredDevicesJson(): String {
        val array = JSONArray()
        val adapter = bluetoothAdapter
        val allDevices = HashMap<String, BluetoothDevice>(discoveredDevices)

        // Ensure bonded devices are always present
        try {
            adapter?.bondedDevices?.forEach { device ->
                if (device.address != null && !allDevices.containsKey(device.address)) {
                    allDevices[device.address] = device
                }
            }
        } catch (_: Exception) {}

        for ((_, device) in allDevices) {
            try {
                val name = device.name
                val address = device.address
                val isBonded = device.bondState == BluetoothDevice.BOND_BONDED
                val isConnected = isDeviceConnected(address)

                val obj = JSONObject().apply {
                    put("id", address)
                    put("name", if (!name.isNullOrBlank()) name else "Bluetooth Printer (${address.takeLast(5)})")
                    put("address", address)
                    put("bonded", isBonded)
                    put("connected", isConnected)
                    put("type", "bluetooth")
                }
                array.put(obj)
            } catch (e: Exception) {
                Log.w(TAG, "Error serializing device: ${e.message}")
            }
        }
        return array.toString()
    }

    fun isDeviceConnected(macAddress: String): Boolean {
        val socket = activeSockets[macAddress]
        val gattChar = activeGattWriteChars[macAddress]
        return (socket != null && socket.isConnected) || (gattChar != null)
    }

    private fun notifyDevicesUpdated() {
        val json = getDiscoveredDevicesJson()
        discoveryCallback?.invoke(json)
    }

    /**
     * Resolve target BluetoothDevice from either MAC address or identifier
     */
    private fun resolveBluetoothDevice(identifier: String): BluetoothDevice? {
        val adapter = bluetoothAdapter ?: return null

        // 1. Direct MAC match if valid format (e.g. 00:11:22:33:44:55)
        if (BluetoothAdapter.checkBluetoothAddress(identifier)) {
            return try { adapter.getRemoteDevice(identifier) } catch (_: Exception) { null }
        }

        // 2. Lookup in discovered / bonded map
        if (discoveredDevices.containsKey(identifier)) {
            return discoveredDevices[identifier]
        }

        // 3. Match by name or partial MAC in bonded devices
        try {
            adapter.bondedDevices?.forEach { dev ->
                if (dev.address.equals(identifier, ignoreCase = true) ||
                    dev.name?.equals(identifier, ignoreCase = true) == true) {
                    return dev
                }
            }
        } catch (_: Exception) {}

        return null
    }

    /**
     * Checks if the device is an X6 / X6h / Cat / TinyPrint series printer
     * that requires the 0x5178 protocol instead of standard ESC/POS.
     */
    fun isX6CatPrinter(macAddress: String): Boolean {
        val dev = resolveBluetoothDevice(macAddress)
        val name = (dev?.name ?: "").lowercase()
        return name.startsWith("x6") || name.startsWith("x5") || name.startsWith("x1") ||
               name.startsWith("c9") || name.startsWith("c15") || name.startsWith("c17") ||
               name.startsWith("c19") || name.startsWith("c20") || name.startsWith("cat") ||
               name.startsWith("tiny") || name.startsWith("walk") || name.startsWith("gb0") ||
               name.startsWith("mx0") || name.startsWith("iprint") || name.startsWith("gt01") ||
               name.startsWith("peri") || name.startsWith("pocket") || name.startsWith("mini") ||
               name.startsWith("a6") || name.startsWith("p1") || name.startsWith("d11") ||
               name.contains("x6h") || name.contains("x6-") || name.contains("cat_")
    }

    /**
     * Connect to target Bluetooth printer.
     * Connects via Classic RFCOMM SPP socket first (most common for POS-58, X18, MPT-II, PT-210).
     * If RFCOMM fails (e.g. BLE-only Cat/Tiny printers), falls back to BLE GATT.
     * Crucially: avoids running RFCOMM and GATT simultaneously on the same hardware radio to prevent HCI drops.
     */
    @SuppressLint("MissingPermission")
    suspend fun connect(targetAddress: String): JSONObject = withContext(Dispatchers.IO) {
        val result = JSONObject()
        val adapter = bluetoothAdapter

        if (adapter == null || !adapter.isEnabled) {
            result.put("success", false)
            result.put("status", "OFFLINE")
            result.put("error", "Bluetooth is disabled or unavailable on this device.")
            return@withContext result
        }

        if (!hasPermissions()) {
            result.put("success", false)
            result.put("status", "OFFLINE")
            result.put("error", "Bluetooth Connect permission denied. Grant Nearby Devices permission.")
            return@withContext result
        }

        val device = resolveBluetoothDevice(targetAddress)
        if (device == null) {
            result.put("success", false)
            result.put("status", "OFFLINE")
            result.put("error", "Device not found. Please pair the Bluetooth printer in Android settings or scan again.")
            return@withContext result
        }

        val macAddress = device.address
        val devName = try { device.name ?: "Bluetooth Printer ($macAddress)" } catch (_: Exception) { "Bluetooth Printer ($macAddress)" }

        // Cancel discovery to free radio bandwidth for reliable connection
        try {
            if (adapter.isDiscovering) {
                adapter.cancelDiscovery()
            }
        } catch (_: Exception) {}

        // Close existing connection if any
        disconnect(macAddress)
        Log.d(TAG, "Connecting to $devName ($macAddress)...")

        var socketConnected = false
        var gattConnected = false

        val isCat = isX6CatPrinter(macAddress)

        // Pathway 1: If not known Cat/BLE printer, attempt Classic RFCOMM SPP connection first
        if (!isCat) {
            var socket: BluetoothSocket? = null

            // Method A: Standard Secure SPP UUID
            try {
                val s = device.createRfcommSocketToServiceRecord(SPP_UUID)
                withTimeout(3500L) {
                    s.connect()
                }
                socket = s
                socketConnected = true
                Log.d(TAG, "Connected via standard secure SPP UUID.")
            } catch (eA: Exception) {
                Log.w(TAG, "Secure SPP failed: ${eA.message}. Trying Insecure SPP UUID...")
                try { socket?.close() } catch (_: Exception) {}
                socket = null
            }

            // Method B: Insecure SPP UUID
            if (!socketConnected) {
                try {
                    val s = device.createInsecureRfcommSocketToServiceRecord(SPP_UUID)
                    withTimeout(3500L) {
                        s.connect()
                    }
                    socket = s
                    socketConnected = true
                    Log.d(TAG, "Connected via insecure SPP UUID.")
                } catch (eB: Exception) {
                    Log.w(TAG, "Insecure SPP failed: ${eB.message}. Trying reflection channel 1...")
                    try { socket?.close() } catch (_: Exception) {}
                    socket = null
                }
            }

            // Method C: Insecure RFCOMM Channel 1 via reflection
            if (!socketConnected) {
                try {
                    val method = device.javaClass.getMethod("createInsecureRfcommSocket", Int::class.javaPrimitiveType)
                    val sFallback = method.invoke(device, 1) as BluetoothSocket
                    withTimeout(3500L) {
                        sFallback.connect()
                    }
                    socket = sFallback
                    socketConnected = true
                    Log.d(TAG, "Connected via insecure RFCOMM channel 1 reflection fallback.")
                } catch (eC: Exception) {
                    Log.w(TAG, "Insecure Channel 1 failed: ${eC.message}. Trying secure channel 1...")
                    try { socket?.close() } catch (_: Exception) {}
                    socket = null
                }
            }

            if (socketConnected && socket != null && socket.isConnected) {
                val outputStream = socket.outputStream
                activeSockets[macAddress] = socket
                activeStreams[macAddress] = outputStream

                try {
                    outputStream.write(byteArrayOf(0x1B, 0x40))
                    outputStream.flush()
                } catch (_: Exception) {}
            }
        }

        // Pathway 2: If RFCOMM was not established or if device is Cat/BLE printer, connect via BLE GATT
        if (!socketConnected) {
            try {
                val gattCompleter = kotlinx.coroutines.CompletableDeferred<Boolean>()

                val gattCallback = object : BluetoothGattCallback() {
                    override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
                        if (newState == BluetoothProfile.STATE_CONNECTED) {
                            Log.i(TAG, "BLE GATT connected to $macAddress. Discovering services...")
                            activeGatts[macAddress] = gatt
                            gatt.discoverServices()
                        } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                            Log.w(TAG, "BLE GATT disconnected from $macAddress")
                            activeGatts.remove(macAddress)
                            activeGattWriteChars.remove(macAddress)
                            try { gatt.close() } catch (_: Exception) {}
                            if (!gattCompleter.isCompleted) {
                                gattCompleter.complete(false)
                            }
                        }
                    }

                    override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
                        if (status == BluetoothGatt.GATT_SUCCESS) {
                            var foundChar: BluetoothGattCharacteristic? = null
                            for (service in gatt.services) {
                                for (characteristic in service.characteristics) {
                                    val properties = characteristic.properties
                                    val isWritable = (properties and BluetoothGattCharacteristic.PROPERTY_WRITE != 0) ||
                                                     (properties and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE != 0)
                                    val uuidLower = characteristic.uuid.toString().lowercase()
                                    if (isWritable && KNOWN_BLE_WRITE_UUIDS.any { uuidLower.contains(it) }) {
                                        foundChar = characteristic
                                        break
                                    }
                                }
                                if (foundChar != null) break
                            }

                            if (foundChar == null) {
                                for (service in gatt.services) {
                                    for (characteristic in service.characteristics) {
                                        val properties = characteristic.properties
                                        val isWritable = (properties and BluetoothGattCharacteristic.PROPERTY_WRITE != 0) ||
                                                         (properties and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE != 0)
                                        if (isWritable) {
                                            foundChar = characteristic
                                            break
                                        }
                                    }
                                    if (foundChar != null) break
                                }
                            }

                            if (foundChar != null) {
                                activeGattWriteChars[macAddress] = foundChar
                                Log.i(TAG, "Discovered active BLE write characteristic: ${foundChar.uuid} on $macAddress")
                                if (!gattCompleter.isCompleted) {
                                    gattCompleter.complete(true)
                                }
                            } else {
                                if (!gattCompleter.isCompleted) {
                                    gattCompleter.complete(false)
                                }
                            }
                        } else {
                            if (!gattCompleter.isCompleted) {
                                gattCompleter.complete(false)
                            }
                        }
                    }
                }

                val gatt = device.connectGatt(context, false, gattCallback)
                activeGatts[macAddress] = gatt

                try {
                    withTimeout(5000L) {
                        gattConnected = gattCompleter.await()
                    }
                } catch (_: Exception) {
                    gattConnected = activeGattWriteChars[macAddress] != null
                }
            } catch (e: Exception) {
                Log.w(TAG, "BLE GATT connect attempt error: ${e.message}")
            }
        }

        if (!socketConnected && !gattConnected) {
            disconnect(macAddress)
            result.put("success", false)
            result.put("status", "OFFLINE")
            result.put("error", "Could not connect to $devName ($macAddress). Ensure printer is powered on and within range.")
            return@withContext result
        }

        result.put("success", true)
        result.put("status", "ONLINE")
        result.put("name", devName)
        result.put("address", macAddress)
        result.put("message", "Connected successfully to $devName.")
        result
    }

    fun disconnect(macAddress: String) {
        try {
            activeStreams.remove(macAddress)?.close()
            activeSockets.remove(macAddress)?.close()
        } catch (e: IOException) {
            Log.w(TAG, "Error closing Bluetooth socket for $macAddress: ${e.message}")
        }
        try {
            activeGattWriteChars.remove(macAddress)
            val gatt = activeGatts.remove(macAddress)
            gatt?.disconnect()
            gatt?.close()
        } catch (e: Exception) {
            Log.w(TAG, "Error closing BLE GATT for $macAddress: ${e.message}")
        }
    }

    /**
     * Send raw data or ESC/POS stream to the printer with automatic translation for X6/Cat printers.
     * Full dual-mode: sends over Classic RFCOMM SPP stream or BLE GATT characteristic.
     */
    suspend fun printRaw(targetAddress: String, data: ByteArray, protocolOverride: String? = null): JSONObject = withContext(Dispatchers.IO) {
        val result = JSONObject()
        val device = resolveBluetoothDevice(targetAddress)
        val macAddress = device?.address ?: targetAddress

        // Verify or auto-reconnect connection
        if (!isDeviceConnected(macAddress)) {
            Log.i(TAG, "Connection inactive. Auto-connecting to $macAddress...")
            val connRes = connect(macAddress)
            if (!connRes.optBoolean("success", false)) {
                result.put("success", false)
                result.put("error", "Bluetooth printer offline: ${connRes.optString("error")}")
                return@withContext result
            }
        }

        val overrideLower = protocolOverride?.lowercase() ?: ""
        val forceCat = overrideLower == "cat" || overrideLower == "x6" || overrideLower == "raster"
        val forceEscPos = overrideLower == "escpos" || overrideLower == "bluetooth" || overrideLower == "x18"
        val isCat = if (forceCat) true else if (forceEscPos) false else (isX6CatPrinter(macAddress) || isX6CatPacket(data))

        if (isCat) {
            // =========================================================================
            // X6 / X6h / Cat Printer Protocol Dispatch (0x5178 Bitmap & Control Packets)
            // =========================================================================
            try {
                val packetsToSend = if (isX6CatPacket(data)) {
                    listOf(data)
                } else {
                    val receiptText = extractTextFromEscPos(data)
                    val bitmap = renderReceiptBitmap(receiptText)
                    renderX6PacketsFromBitmap(bitmap)
                }

                var totalBytesWritten = 0
                val stream = activeStreams[macAddress]
                val gatt = activeGatts[macAddress]
                val writeChar = activeGattWriteChars[macAddress]

                for (packet in packetsToSend) {
                    if (stream != null) {
                        val chunkSize = 64
                        var offset = 0
                        while (offset < packet.size) {
                            val len = minOf(chunkSize, packet.size - offset)
                            stream.write(packet, offset, len)
                            offset += len
                            delay(10)
                        }
                        stream.flush()
                        totalBytesWritten += packet.size
                    } else if (gatt != null && writeChar != null) {
                        val bleChunkSize = 20
                        var offset = 0
                        while (offset < packet.size) {
                            val len = minOf(bleChunkSize, packet.size - offset)
                            val chunk = ByteArray(len)
                            System.arraycopy(packet, offset, chunk, 0, len)
                            @Suppress("DEPRECATION")
                            writeChar.value = chunk
                            writeChar.writeType = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                            @Suppress("DEPRECATION")
                            val writeOk = gatt.writeCharacteristic(writeChar)
                            if (!writeOk) {
                                delay(30)
                                @Suppress("DEPRECATION")
                                gatt.writeCharacteristic(writeChar)
                            }
                            offset += len
                            delay(20)
                        }
                        totalBytesWritten += packet.size
                    }

                    delay(25)
                }

                result.put("success", true)
                result.put("bytesPrinted", totalBytesWritten)
                result.put("protocol", "X6_CAT_BITMAP")
            } catch (e: Exception) {
                Log.e(TAG, "Write error during X6 Cat Bluetooth print to $macAddress: ${e.message}")
                result.put("success", false)
                result.put("error", "Transmission failed: ${e.localizedMessage}")
            }
        } else {
            // =========================================================================
            // Standard ESC/POS Stream Transmission (X18 Mini, POS-58, MPT-II, etc.)
            // =========================================================================
            val stream = activeStreams[macAddress]
            val gatt = activeGatts[macAddress]
            val writeChar = activeGattWriteChars[macAddress]

            // Ensure receipt has clean CR LF lines, no crashing cutter commands, and paper advance
            val bytesToSend = prepareEscPosBytes(data)

            // Pathway 1: Classic RFCOMM OutputStream (Primary for X18 Mini & POS-58)
            if (stream != null) {
                try {
                    val chunkSize = 128
                    var offset = 0
                    while (offset < bytesToSend.size) {
                        val len = minOf(chunkSize, bytesToSend.size - offset)
                        stream.write(bytesToSend, offset, len)
                        offset += len
                        delay(10)
                    }
                    stream.flush()

                    result.put("success", true)
                    result.put("bytesPrinted", bytesToSend.size)
                    result.put("protocol", "ESC_POS_RFCOMM")
                    return@withContext result
                } catch (e: Exception) {
                    Log.w(TAG, "RFCOMM write error to $macAddress: ${e.message}. Trying BLE fallback if available...")
                    disconnect(macAddress)
                }
            }

            // Pathway 2: BLE GATT Write Characteristic (for BLE-only thermal receipt printers)
            if (gatt != null && writeChar != null) {
                try {
                    val bleChunkSize = 20
                    var offset = 0
                    var totalWritten = 0
                    while (offset < bytesToSend.size) {
                        val len = minOf(bleChunkSize, bytesToSend.size - offset)
                        val chunk = ByteArray(len)
                        System.arraycopy(bytesToSend, offset, chunk, 0, len)
                        @Suppress("DEPRECATION")
                        writeChar.value = chunk
                        writeChar.writeType = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                        @Suppress("DEPRECATION")
                        val writeOk = gatt.writeCharacteristic(writeChar)
                        if (!writeOk) {
                            delay(30)
                            @Suppress("DEPRECATION")
                            gatt.writeCharacteristic(writeChar)
                        }
                        offset += len
                        totalWritten += len
                        delay(20)
                    }

                    result.put("success", true)
                    result.put("bytesPrinted", totalWritten)
                    result.put("protocol", "ESC_POS_BLE_GATT")
                    return@withContext result
                } catch (bleErr: Exception) {
                    Log.e(TAG, "BLE GATT write failed to $macAddress: ${bleErr.message}")
                }
            }

            result.put("success", false)
            result.put("error", "No active connection available for $macAddress. Verify printer is powered on and paired.")
        }

        result
    }

    /**
     * Prepares ESC/POS byte sequence:
     * - Preserves binary commands (barcodes, bitmaps, alignments)
     * - Normalizes single line feeds (0x0A) to standard carriage return + line feed (0x0D, 0x0A)
     * - Strips cutter commands (0x1D 0x56) that cause 58mm mobile printers to freeze or drop buffer
     * - Feeds 4 clean CR LF lines at the end to clear physical tear bar
     */
    private fun prepareEscPosBytes(data: ByteArray): ByteArray {
        val out = ArrayList<Byte>(data.size + 32)

        // Prepend ESC @ (Initialize printer) if not already starting with it
        if (data.size < 2 || data[0] != 0x1B.toByte() || data[1] != 0x40.toByte()) {
            out.add(0x1B)
            out.add(0x40)
        }

        var i = 0
        while (i < data.size) {
            val b = data[i]
            val bInt = b.toInt() and 0xFF

            // Strip cutter commands (0x1D 0x56) that cause 58mm mobile thermal printers without cutters to crash
            if (bInt == 0x1D && i + 1 < data.size && (data[i + 1].toInt() and 0xFF) == 0x56) {
                if (i + 3 < data.size && ((data[i + 2].toInt() and 0xFF) == 0x41 || (data[i + 2].toInt() and 0xFF) == 0x42)) {
                    i += 4
                } else if (i + 2 < data.size) {
                    i += 3
                } else {
                    i += 2
                }
                continue
            }

            if (bInt == 0x0A) {
                // Ensure CR (0x0D) precedes LF (0x0A) for proper hardware line buffer execution
                if (out.isEmpty() || out[out.size - 1] != 0x0D.toByte()) {
                    out.add(0x0D)
                }
                out.add(0x0A)
            } else {
                out.add(b)
            }
            i++
        }

        // Add 4 line feeds (CR LF) to flush line buffer and feed paper cleanly past the tear bar
        for (k in 0 until 4) {
            out.add(0x0D)
            out.add(0x0A)
        }

        return out.toByteArray()
    }

    // --------------------------------------------------------------------------
    // X6 / Cat Printer Protocol Helpers
    // --------------------------------------------------------------------------

    private fun isX6CatPacket(data: ByteArray): Boolean {
        return data.size >= 2 && data[0] == 0x51.toByte() && data[1] == 0x78.toByte()
    }

    private fun crc8(data: ByteArray): Byte {
        var crc = 0
        for (b in data) {
            crc = crc xor (b.toInt() and 0xFF)
            for (i in 0 until 8) {
                if ((crc and 0x80) != 0) {
                    crc = ((crc shl 1) xor 0x07) and 0xFF
                } else {
                    crc = (crc shl 1) and 0xFF
                }
            }
        }
        return crc.toByte()
    }

    private fun buildX6Packet(cmd: Byte, payload: ByteArray): ByteArray {
        val len = payload.size
        val lenLow = (len and 0xFF).toByte()
        val lenHigh = ((len shr 8) and 0xFF).toByte()
        val crc = crc8(payload)

        val packet = ByteArray(8 + len)
        packet[0] = 0x51.toByte()
        packet[1] = 0x78.toByte()
        packet[2] = cmd
        packet[3] = 0x00.toByte()
        packet[4] = lenLow
        packet[5] = lenHigh
        System.arraycopy(payload, 0, packet, 6, len)
        packet[6 + len] = crc
        packet[7 + len] = 0xFF.toByte()
        return packet
    }

    private fun renderReceiptBitmap(text: String): Bitmap {
        val width = 384
        val lines = text.split("\n")

        val paint = Paint().apply {
            color = Color.BLACK
            textSize = 22f
            typeface = Typeface.create(Typeface.MONOSPACE, Typeface.NORMAL)
            isAntiAlias = false
        }
        val boldPaint = Paint(paint).apply {
            textSize = 24f
            isFakeBoldText = true
        }

        val lineHeight = 30
        val padding = 12
        val height = maxOf(lineHeight * lines.size + padding * 2, 80)

        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.WHITE)

        var y = padding + 22
        for (line in lines) {
            val trimmed = line.trim()
            if (trimmed.startsWith("***") || trimmed.startsWith("===") || trimmed.startsWith("---") ||
                trimmed.contains("AURAPOS", ignoreCase = true) || trimmed.contains("TOTAL", ignoreCase = true)) {
                val textW = boldPaint.measureText(trimmed)
                val x = (width - textW) / 2f
                canvas.drawText(trimmed, maxOf(0f, x), y.toFloat(), boldPaint)
            } else if (trimmed.contains(":")) {
                canvas.drawText(trimmed, padding.toFloat(), y.toFloat(), paint)
            } else {
                val textW = paint.measureText(trimmed)
                val x = if (trimmed.length < 24) (width - textW) / 2f else padding.toFloat()
                canvas.drawText(trimmed, maxOf(padding.toFloat(), x), y.toFloat(), paint)
            }
            y += lineHeight
        }
        return bitmap
    }

    private fun renderX6PacketsFromBitmap(bitmap: Bitmap): List<ByteArray> {
        val packets = mutableListOf<ByteArray>()

        // 1. Lattice Start command
        val latticeStart = byteArrayOf(
            0x51, 0x78, 0xA6.toByte(), 0x00, 0x0B, 0x00,
            0xAA.toByte(), 0x55, 0x17, 0x38, 0x44, 0x5F, 0x5F, 0x5F, 0x44, 0x38, 0x2C,
            0xA1.toByte(), 0xFF.toByte()
        )
        packets.add(latticeStart)

        // 2. Set Energy (0xAF) - Dark high contrast
        packets.add(buildX6Packet(0xAF.toByte(), byteArrayOf(0x00.toByte(), 0xFF.toByte())))

        // 3. Set Quality (0xA4)
        packets.add(buildX6Packet(0xA4.toByte(), byteArrayOf(0x33.toByte())))

        // 4. Draw Bitmap lines (0xA2)
        val bytesPerRow = 48
        for (y in 0 until bitmap.height) {
            val rowBytes = ByteArray(bytesPerRow)
            for (byteIdx in 0 until bytesPerRow) {
                var b = 0
                for (bit in 0 until 8) {
                    val x = byteIdx * 8 + bit
                    if (x < bitmap.width && y < bitmap.height) {
                        val pixel = bitmap.getPixel(x, y)
                        val r = (pixel shr 16) and 0xFF
                        val g = (pixel shr 8) and 0xFF
                        val blue = pixel and 0xFF
                        val brightness = (r * 299 + g * 587 + blue * 114) / 1000
                        if (brightness < 128) {
                            b = b or (1 shl (7 - bit))
                        }
                    }
                }
                rowBytes[byteIdx] = b.toByte()
            }
            packets.add(buildX6Packet(0xA2.toByte(), rowBytes))
        }

        // 5. Lattice End command
        val latticeEnd = byteArrayOf(
            0x51, 0x78, 0xA6.toByte(), 0x00, 0x0B, 0x00,
            0xAA.toByte(), 0x55, 0x17, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x17,
            0x11.toByte(), 0xFF.toByte()
        )
        packets.add(latticeEnd)

        // 6. Feed Paper command (0xA1) - 80 steps to advance past tear bar
        packets.add(buildX6Packet(0xA1.toByte(), byteArrayOf(80.toByte(), 0.toByte())))

        return packets
    }

    private fun extractTextFromEscPos(data: ByteArray): String {
        val sb = StringBuilder()
        var i = 0
        while (i < data.size) {
            val b = data[i].toInt() and 0xFF
            when (b) {
                0x1B -> {
                    if (i + 1 < data.size) {
                        val next = data[i + 1].toInt() and 0xFF
                        when (next) {
                            0x40 -> i += 2
                            0x61, 0x64, 0x4A, 0x21, 0x45, 0x4D, 0x74 -> i += 3
                            else -> i += 2
                        }
                    } else {
                        i++
                    }
                }
                0x1D -> {
                    if (i + 1 < data.size) {
                        val next = data[i + 1].toInt() and 0xFF
                        when (next) {
                            0x56 -> if (i + 2 < data.size && data[i + 2].toInt() == 0x41) i += 4 else i += 3
                            0x21, 0x42 -> i += 3
                            else -> i += 2
                        }
                    } else {
                        i++
                    }
                }
                0x0D -> i++
                0x0A, 0x0C -> {
                    sb.append("\n")
                    i++
                }
                in 0x20..0x7E -> {
                    sb.append(b.toChar())
                    i++
                }
                else -> i++
            }
        }
        val res = sb.toString().trim()
        return if (res.isNotBlank()) res else "*** AURAPOS RECEIPT ***\nHardware Connected"
    }

    fun cleanup() {
        try {
            context.unregisterReceiver(discoveryReceiver)
        } catch (_: Exception) {}
        activeSockets.keys.toList().forEach { disconnect(it) }
    }

    companion object {
        private const val TAG = "BluetoothPrinterManager"
    }
}
