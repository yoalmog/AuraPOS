package com.aurapos.pos.hardware

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.*
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
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
import android.os.ParcelUuid
import android.util.Log
import androidx.core.content.ContextCompat
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.io.OutputStream
import java.util.*
import java.util.concurrent.ConcurrentHashMap

/**
 * Transport and Protocol Abstractions for AuraPOS Hardware Architecture
 */
enum class PrinterTransport {
    BLE_GATT,
    CLASSIC_RFCOMM,
    USB,
    NETWORK
}

enum class PrinterProtocol {
    X6H_BLE,
    ESC_POS,
    SUNMI
}

enum class X6hPrinterState {
    DISCONNECTED,
    CONNECTING,
    DISCOVERING_SERVICES,
    CONFIGURING,
    READY,
    PRINTING,
    WAITING_FOR_STATUS,
    COMPLETED,
    ERROR,
    PAPER_OUT,
    DISCONNECTED_DURING_PRINT
}

data class GattWriteResult(
    val success: Boolean,
    val statusCode: Int = 0,
    val statusDescription: String = "SUCCESS",
    val writeTypeUsed: Int = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT,
    val bytesWritten: Int = 0,
    val errorMessage: String? = null
)

/**
 * Production-grade Bluetooth Hardware Driver for AuraPOS
 *
 * Dedicated Support for:
 * 1. X6h / X6 / Cat / WalkPrint / TinyPrint BLE Thermal Printers (0000AE30 service, 0x5178 Protocol, 0xBE Drawing Mode, 384-dot raster LSB-first)
 * 2. Standard ESC/POS Bluetooth Thermal Printers (X18 Mini, POS-58, MPT-II, PT-210, Rongta, Epson) via RFCOMM SPP & Generic BLE GATT
 */
class BluetoothPrinterManager(private val context: Context) {

    private val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    private val bluetoothAdapter: BluetoothAdapter?
        get() = bluetoothManager?.adapter ?: BluetoothAdapter.getDefaultAdapter()

    // -------------------------------------------------------------
    // Active Connection Maps
    // -------------------------------------------------------------
    // Classic RFCOMM SPP sockets & streams
    private val activeSockets = ConcurrentHashMap<String, BluetoothSocket>()
    private val activeStreams = ConcurrentHashMap<String, OutputStream>()

    // Bluetooth Low Energy (BLE GATT)
    private val activeGatts = ConcurrentHashMap<String, BluetoothGatt>()
    private val activeGattWriteChars = ConcurrentHashMap<String, BluetoothGattCharacteristic>()
    private val activeGattNotifyChars = ConcurrentHashMap<String, BluetoothGattCharacteristic>()
    private val activeGattWriteType = ConcurrentHashMap<String, Int>()
    private val gattWriteMutexes = ConcurrentHashMap<String, Mutex>()
    private val pendingWriteDeferreds = ConcurrentHashMap<String, CompletableDeferred<GattWriteResult>>()
    private val pendingDescriptorDeferreds = ConcurrentHashMap<String, CompletableDeferred<Boolean>>()
    private val activeMtuMap = ConcurrentHashMap<String, Int>()
    private val x6hStateMap = ConcurrentHashMap<String, X6hPrinterState>()
    private val lastGattStatusMap = ConcurrentHashMap<String, Int>()
    private val diagnosticInfoMap = ConcurrentHashMap<String, JSONObject>()

    // Discovered devices during active scan
    private val discoveredDevices = ConcurrentHashMap<String, BluetoothDevice>()
    private var isScanning = false
    private var discoveryCallback: ((String) -> Unit)? = null

    // UUID Constants
    private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    private val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

    // Dedicated X6h Cat Printer UUIDs
    val X6H_SERVICE_UUID: UUID = UUID.fromString("0000AE30-0000-1000-8000-00805F9B34FB")
    val X6H_WRITE_CHAR_UUID: UUID = UUID.fromString("0000AE01-0000-1000-8000-00805F9B34FB")
    val X6H_NOTIFY_CHAR_UUID: UUID = UUID.fromString("0000AE02-0000-1000-8000-00805F9B34FB")

    // Other known ESC/POS BLE Characteristic UUID substrings
    private val KNOWN_GENERIC_BLE_WRITE_UUIDS = listOf(
        "ae01", "ffe1", "ff02", "2af1", "fee1", "fec7", "e7810a71", "e7810a72", "49535343", "6e400002"
    )

    // -------------------------------------------------------------
    // Device Discovery (Classic BroadcastReceiver + BLE Scanner)
    // -------------------------------------------------------------
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
                    notifyDevicesUpdated()
                }
                BluetoothAdapter.ACTION_STATE_CHANGED -> {
                    notifyDevicesUpdated()
                }
            }
        }
    }

    private val bleScanCallback = object : ScanCallback() {
        @SuppressLint("MissingPermission")
        override fun onScanResult(callbackType: Int, result: ScanResult?) {
            val device = result?.device ?: return
            if (device.address != null) {
                discoveredDevices[device.address] = device
                notifyDevicesUpdated()
            }
        }

        @SuppressLint("MissingPermission")
        override fun onBatchScanResults(results: MutableList<ScanResult>?) {
            results?.forEach { res ->
                val device = res.device
                if (device != null && device.address != null) {
                    discoveredDevices[device.address] = device
                }
            }
            notifyDevicesUpdated()
        }

        override fun onScanFailed(errorCode: Int) {
            Log.w(TAG, "BLE Scanner failed with error code: $errorCode")
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
        } catch (e: SecurityException) {
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

        // 1. Populate bonded devices immediately
        try {
            adapter.bondedDevices?.forEach { device ->
                if (device.address != null) {
                    discoveredDevices[device.address] = device
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error querying bonded devices: ${e.message}")
        }

        // 2. Start Classic Bluetooth discovery
        try {
            if (adapter.isDiscovering) {
                adapter.cancelDiscovery()
            }
            adapter.startDiscovery()
        } catch (e: Exception) {
            Log.w(TAG, "Classic discovery error: ${e.message}")
        }

        // 3. Start BLE Scanner (essential for X6h/Cat printers that are pure BLE)
        try {
            val bleScanner = adapter.bluetoothLeScanner
            if (bleScanner != null) {
                val settings = ScanSettings.Builder()
                    .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                    .build()
                bleScanner.startScan(null, settings, bleScanCallback)
            }
        } catch (e: Exception) {
            Log.w(TAG, "BLE scan start error: ${e.message}")
        }

        isScanning = true
        notifyDevicesUpdated()

        return JSONObject().apply {
            put("success", true)
            put("isScanning", true)
            put("message", "Bluetooth Classic and BLE hardware scan initiated.")
        }.toString()
    }

    @SuppressLint("MissingPermission")
    fun stopScan() {
        try {
            if (bluetoothAdapter?.isDiscovering == true) {
                bluetoothAdapter?.cancelDiscovery()
            }
            bluetoothAdapter?.bluetoothLeScanner?.stopScan(bleScanCallback)
        } catch (e: Exception) {}
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
        } catch (e: Exception) {}

        for ((_, device) in allDevices) {
            try {
                val rawName = device.name
                val address = device.address
                val isBonded = device.bondState == BluetoothDevice.BOND_BONDED
                val isConnected = isDeviceConnected(address)
                val isX6 = isX6CatPrinter(address)

                val displayName = if (!rawName.isNullOrBlank()) {
                    rawName
                } else if (isX6) {
                    "X6 Mini BLE Printer (${address.takeLast(5)})"
                } else {
                    "Bluetooth Printer (${address.takeLast(5)})"
                }

                val obj = JSONObject().apply {
                    put("id", address)
                    put("name", displayName)
                    put("address", address)
                    put("bonded", isBonded)
                    put("connected", isConnected)
                    put("type", "bluetooth")
                    put("model", if (isX6) "Cat / X6 Mini BLE Printer" else "ESC/POS Bluetooth Thermal")
                    put("protocol", if (isX6) "X6H_BLE" else "ESC_POS")
                    put("paperWidth", 58)
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
        val x6State = x6hStateMap[macAddress]
        val isGattReady = (gattChar != null && (x6State == X6hPrinterState.READY || x6State == X6hPrinterState.PRINTING || x6State == X6hPrinterState.COMPLETED))
        return (socket != null && socket.isConnected) || isGattReady
    }

    fun getX6hState(macAddress: String): X6hPrinterState {
        return x6hStateMap[macAddress] ?: X6hPrinterState.DISCONNECTED
    }

    private fun notifyDevicesUpdated() {
        val json = getDiscoveredDevicesJson()
        discoveryCallback?.invoke(json)
    }

    fun resolveBluetoothDevice(identifier: String): BluetoothDevice? {
        val adapter = bluetoothAdapter ?: return null

        if (BluetoothAdapter.checkBluetoothAddress(identifier)) {
            return try { adapter.getRemoteDevice(identifier) } catch (e: Exception) { null }
        }

        if (discoveredDevices.containsKey(identifier)) {
            return discoveredDevices[identifier]
        }

        try {
            adapter.bondedDevices?.forEach { dev ->
                if (dev.address.equals(identifier, ignoreCase = true) ||
                    dev.name?.equals(identifier, ignoreCase = true) == true) {
                    return dev
                }
            }
        } catch (e: Exception) {}

        return null
    }

    fun isX6CatPrinter(identifier: String): Boolean {
        val dev = resolveBluetoothDevice(identifier)
        val name = (dev?.name ?: identifier).lowercase()
        return name.contains("x6h") || name.contains("x6-") || name.startsWith("x6") ||
               name.contains("cat") || name.contains("tiny") || name.contains("walk") ||
               name.startsWith("c9") || name.startsWith("c15") || name.startsWith("c17") ||
               name.startsWith("c19") || name.startsWith("c20") || name.startsWith("gb0") ||
               name.startsWith("mx0") || name.startsWith("gt01") || name.startsWith("iprint") ||
               name.startsWith("peri") || name.startsWith("pocket") || name.startsWith("mini") ||
               name.startsWith("sc03") || name.contains("ble printer")
    }

    // -------------------------------------------------------------
    // Connection Management (BLE GATT for X6h + RFCOMM SPP Fallback)
    // -------------------------------------------------------------

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
            result.put("error", "Device not found. Please scan again or verify the printer is powered on.")
            return@withContext result
        }

        val macAddress = device.address
        val devName = try { device.name ?: "Printer ($macAddress)" } catch (e: Exception) { "Printer ($macAddress)" }

        stopScan()
        disconnect(macAddress)

        val isCat = isX6CatPrinter(macAddress)
        Log.i(TAG, "Connecting to $devName ($macAddress) | isX6hCat=$isCat...")

        // Pathway 1: Dedicated X6h BLE GATT Driver
        if (isCat) {
            return@withContext connectX6hBle(device, devName)
        }

        // Pathway 2: Standard ESC/POS Bluetooth Thermal (RFCOMM SPP)
        var socket: BluetoothSocket? = null
        var socketConnected = false

        try {
            val s = device.createRfcommSocketToServiceRecord(SPP_UUID)
            withTimeout(3500L) { s.connect() }
            socket = s
            socketConnected = true
            Log.d(TAG, "Connected to $devName via standard secure SPP UUID.")
        } catch (eA: Exception) {
            Log.w(TAG, "Secure SPP failed: ${eA.message}. Trying Insecure SPP...")
            try { socket?.close() } catch (e: Exception) {}
            socket = null
        }

        if (!socketConnected) {
            try {
                val s = device.createInsecureRfcommSocketToServiceRecord(SPP_UUID)
                withTimeout(3500L) { s.connect() }
                socket = s
                socketConnected = true
                Log.d(TAG, "Connected to $devName via insecure SPP UUID.")
            } catch (eB: Exception) {
                Log.w(TAG, "Insecure SPP failed: ${eB.message}. Trying reflection channel 1...")
                try { socket?.close() } catch (e: Exception) {}
                socket = null
            }
        }

        if (!socketConnected) {
            try {
                val method = device.javaClass.getMethod("createInsecureRfcommSocket", Int::class.javaPrimitiveType)
                val sFallback = method.invoke(device, 1) as BluetoothSocket
                withTimeout(3500L) { sFallback.connect() }
                socket = sFallback
                socketConnected = true
                Log.d(TAG, "Connected to $devName via reflection channel 1.")
            } catch (eC: Exception) {
                Log.w(TAG, "Reflection channel 1 failed: ${eC.message}.")
                try { socket?.close() } catch (e: Exception) {}
                socket = null
            }
        }

        if (socketConnected && socket != null && socket.isConnected) {
            val outputStream = socket.outputStream
            activeSockets[macAddress] = socket
            activeStreams[macAddress] = outputStream

            try {
                outputStream.write(byteArrayOf(0x1B, 0x40)) // ESC @
                outputStream.flush()
            } catch (e: Exception) {}

            result.put("success", true)
            result.put("status", "ONLINE")
            result.put("transport", "CLASSIC_RFCOMM")
            result.put("protocol", "ESC_POS")
            result.put("name", devName)
            result.put("address", macAddress)
            result.put("message", "Connected successfully to $devName via Classic RFCOMM SPP.")
            return@withContext result
        }

        return@withContext connectGenericBleGatt(device, devName)
    }

    /**
     * Dedicated X6h BLE Driver Connection & Full Service/Characteristic Inspection
     */
    @SuppressLint("MissingPermission")
    private suspend fun connectX6hBle(device: BluetoothDevice, devName: String): JSONObject {
        val result = JSONObject()
        val macAddress = device.address

        Log.i(TAG, "==================================================")
        Log.i(TAG, "X6H: Initiating BLE GATT connection to $devName ($macAddress)")
        Log.i(TAG, "==================================================")
        x6hStateMap[macAddress] = X6hPrinterState.CONNECTING

        val readyDeferred = CompletableDeferred<Boolean>()
        val mutex = Mutex()
        gattWriteMutexes[macAddress] = mutex

        val diagJson = JSONObject().apply {
            put("device", devName)
            put("mac", macAddress)
            put("transport", "BLE / GATT")
            put("gattState", "CONNECTING")
            put("mtu", 23)
            put("services", JSONArray())
            put("selectedWriteChar", "")
            put("selectedWriteProperties", JSONArray())
            put("selectedWriteType", "")
            put("selectedNotifyChar", "")
            put("notificationsStatus", "PENDING")
            put("state", "CONNECTING")
        }
        diagnosticInfoMap[macAddress] = diagJson

        val gattCallback = object : BluetoothGattCallback() {
            override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
                lastGattStatusMap[macAddress] = status
                Log.i(TAG, "X6H onConnectionStateChange: status=$status (${getGattStatusDescription(status)}), newState=$newState")

                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    Log.i(TAG, "X6H: GATT CONNECTED to $devName ($macAddress)")
                    activeGatts[macAddress] = gatt
                    x6hStateMap[macAddress] = X6hPrinterState.DISCOVERING_SERVICES
                    diagJson.put("gattState", "CONNECTED")

                    // Request higher MTU (247) on supported Android versions
                    try {
                        val requested = gatt.requestMtu(247)
                        Log.i(TAG, "X6H: MTU 247 requested (initiated=$requested)")
                    } catch (e: Exception) {
                        Log.w(TAG, "X6H: requestMtu failed: ${e.message}, proceeding immediately to service discovery")
                        gatt.discoverServices()
                    }
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    Log.w(TAG, "X6H: GATT DISCONNECTED (status=$status: ${getGattStatusDescription(status)})")
                    x6hStateMap[macAddress] = X6hPrinterState.DISCONNECTED
                    diagJson.put("gattState", "DISCONNECTED (status $status)")
                    diagJson.put("state", "DISCONNECTED")
                    activeGatts.remove(macAddress)
                    activeGattWriteChars.remove(macAddress)
                    activeGattNotifyChars.remove(macAddress)
                    try { gatt.close() } catch (e: Exception) {}

                    val pending = pendingWriteDeferreds.remove(macAddress)
                    pending?.complete(GattWriteResult(false, status, getGattStatusDescription(status), errorMessage = "GATT disconnected during operation"))

                    val pendingDesc = pendingDescriptorDeferreds.remove(macAddress)
                    pendingDesc?.complete(false)

                    if (!readyDeferred.isCompleted) {
                        readyDeferred.complete(false)
                    }
                }
            }

            override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
                activeMtuMap[macAddress] = mtu
                diagJson.put("mtu", mtu)
                Log.i(TAG, "X6H onMtuChanged: MTU negotiated = $mtu, status = $status (${getGattStatusDescription(status)}), max ATT payload = ${maxOf(20, mtu - 3)}")
                Log.i(TAG, "X6H: Proceeding to discover services...")
                gatt.discoverServices()
            }

            override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
                lastGattStatusMap[macAddress] = status
                if (status != BluetoothGatt.GATT_SUCCESS) {
                    Log.e(TAG, "X6H onServicesDiscovered: Failed with status $status (${getGattStatusDescription(status)})")
                    x6hStateMap[macAddress] = X6hPrinterState.ERROR
                    diagJson.put("state", "SERVICE_DISCOVERY_ERROR ($status)")
                    if (!readyDeferred.isCompleted) readyDeferred.complete(false)
                    return
                }

                Log.i(TAG, "==================================================")
                Log.i(TAG, "X6H GATT SERVICE DISCOVERY: ${gatt.services.size} services discovered for $devName ($macAddress)")
                Log.i(TAG, "==================================================")

                val servicesArray = JSONArray()
                var writeCharCandidate: BluetoothGattCharacteristic? = null
                var notifyCharCandidate: BluetoothGattCharacteristic? = null

                // Complete Service & Characteristic Logging (Task 2 & Task 3)
                for (service in gatt.services) {
                    val sUuidStr = service.uuid.toString().uppercase()
                    Log.i(TAG, "SERVICE: $sUuidStr")
                    val sObj = JSONObject().apply {
                        put("uuid", sUuidStr)
                        put("characteristics", JSONArray())
                    }

                    for (ch in service.characteristics) {
                        val chUuidStr = ch.uuid.toString().uppercase()
                        val props = ch.properties
                        val propStrings = getPropertyStrings(props)
                        val propFormatted = propStrings.joinToString(", ")

                        Log.i(TAG, "  CHARACTERISTIC: $chUuidStr")
                        Log.i(TAG, "    PROPERTIES ($props): [$propFormatted]")

                        val chObj = JSONObject().apply {
                            put("uuid", chUuidStr)
                            put("properties", propFormatted)
                            put("rawProperties", props)
                            put("canWrite", (props and BluetoothGattCharacteristic.PROPERTY_WRITE) != 0)
                            put("canWriteNoResponse", (props and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0)
                            put("canNotify", (props and BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0)
                            put("canIndicate", (props and BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0)
                        }
                        sObj.getJSONArray("characteristics").put(chObj)

                        // 1. Identify Write Characteristic
                        val isWritable = (props and BluetoothGattCharacteristic.PROPERTY_WRITE != 0) ||
                                         (props and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE != 0)

                        if (isWritable) {
                            if (chUuidStr.contains("AE01")) {
                                writeCharCandidate = ch
                                Log.i(TAG, "    -> MATCHED PRIORITY 1 X6H WRITE CHAR: $chUuidStr")
                            } else if (writeCharCandidate == null || !writeCharCandidate.uuid.toString().uppercase().contains("AE01")) {
                                if (KNOWN_GENERIC_BLE_WRITE_UUIDS.any { chUuidStr.lowercase().contains(it) }) {
                                    writeCharCandidate = ch
                                    Log.i(TAG, "    -> MATCHED KNOWN THERMAL WRITE CHAR: $chUuidStr")
                                } else if (writeCharCandidate == null) {
                                    writeCharCandidate = ch
                                    Log.i(TAG, "    -> FOUND GENERIC WRITABLE CHAR CANDIDATE: $chUuidStr")
                                }
                            }
                        }

                        // 2. Identify Notify / Read Characteristic
                        val isNotifiable = (props and BluetoothGattCharacteristic.PROPERTY_NOTIFY != 0) ||
                                           (props and BluetoothGattCharacteristic.PROPERTY_INDICATE != 0)

                        if (isNotifiable) {
                            if (chUuidStr.contains("AE02")) {
                                notifyCharCandidate = ch
                                Log.i(TAG, "    -> MATCHED PRIORITY 1 X6H NOTIFY CHAR: $chUuidStr")
                            } else if (notifyCharCandidate == null || !notifyCharCandidate.uuid.toString().uppercase().contains("AE02")) {
                                notifyCharCandidate = ch
                                Log.i(TAG, "    -> FOUND NOTIFY CHAR CANDIDATE: $chUuidStr")
                            }
                        }
                    }
                    servicesArray.put(sObj)
                }
                diagJson.put("services", servicesArray)
                Log.i(TAG, "==================================================")

                if (writeCharCandidate == null) {
                    Log.e(TAG, "X6H: No writable GATT characteristic discovered on $devName ($macAddress)!")
                    x6hStateMap[macAddress] = X6hPrinterState.ERROR
                    diagJson.put("state", "ERROR_NO_WRITE_CHARACTERISTIC")
                    if (!readyDeferred.isCompleted) readyDeferred.complete(false)
                    return
                }

                // Determine and configure write type (Task 3 & Task 6)
                val writeProps = writeCharCandidate.properties
                val canWriteDefault = (writeProps and BluetoothGattCharacteristic.PROPERTY_WRITE) != 0
                val canWriteNoResp = (writeProps and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0

                val selectedWriteType = when {
                    canWriteNoResp && !canWriteDefault -> BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                    canWriteDefault && !canWriteNoResp -> BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                    canWriteNoResp && canWriteDefault -> BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE // Prefer NO_RESPONSE for high-throughput thermal data
                    else -> BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                }

                activeGattWriteChars[macAddress] = writeCharCandidate
                activeGattWriteType[macAddress] = selectedWriteType

                val writeTypeStr = if (selectedWriteType == BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE) "WRITE_NO_RESPONSE" else "WRITE_DEFAULT"
                Log.i(TAG, "X6H SELECTED WRITE CHAR: ${writeCharCandidate.uuid}")
                Log.i(TAG, "X6H SELECTED WRITE PROPERTIES: [${getPropertyStrings(writeProps).joinToString(", ")}]")
                Log.i(TAG, "X6H SELECTED WRITE TYPE: $writeTypeStr")

                diagJson.put("selectedWriteChar", writeCharCandidate.uuid.toString())
                diagJson.put("selectedWriteProperties", JSONArray(getPropertyStrings(writeProps)))
                diagJson.put("selectedWriteType", writeTypeStr)

                if (notifyCharCandidate != null) {
                    activeGattNotifyChars[macAddress] = notifyCharCandidate
                    diagJson.put("selectedNotifyChar", notifyCharCandidate.uuid.toString())
                    Log.i(TAG, "X6H SELECTED NOTIFY CHAR: ${notifyCharCandidate.uuid}")
                }

                x6hStateMap[macAddress] = X6hPrinterState.CONFIGURING

                // Configure notifications via CCCD (Task 10)
                if (notifyCharCandidate != null) {
                    val notifSet = gatt.setCharacteristicNotification(notifyCharCandidate, true)
                    Log.i(TAG, "X6H: setCharacteristicNotification result: $notifSet")

                    val descriptor = notifyCharCandidate.getDescriptor(CCCD_UUID)
                    if (descriptor != null) {
                        val descDeferred = CompletableDeferred<Boolean>()
                        pendingDescriptorDeferreds[macAddress] = descDeferred

                        val isIndicate = (notifyCharCandidate.properties and BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0
                        val cccdValue = if (isIndicate) BluetoothGattDescriptor.ENABLE_INDICATION_VALUE else BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE

                        @Suppress("DEPRECATION")
                        descriptor.value = cccdValue

                        val descWriteInitiated = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                            gatt.writeDescriptor(descriptor, cccdValue) == 0
                        } else {
                            @Suppress("DEPRECATION")
                            gatt.writeDescriptor(descriptor)
                        }
                        Log.i(TAG, "X6H: writeDescriptor CCCD initiated: $descWriteInitiated")

                        CoroutineScope(Dispatchers.IO).launch {
                            val descSuccess = try {
                                withTimeout(2000L) { descDeferred.await() }
                            } catch (e: Exception) {
                                Log.w(TAG, "X6H: CCCD descriptor write timed out or bypassed, continuing...")
                                false
                            }
                            val notifStatusStr = if (descSuccess) "ENABLED" else "CONFIGURED_WITHOUT_ACK"
                            diagJson.put("notificationsStatus", notifStatusStr)
                            diagJson.put("state", "READY")
                            x6hStateMap[macAddress] = X6hPrinterState.READY
                            Log.i(TAG, "X6H: Driver is fully READY for $devName ($macAddress)")
                            if (!readyDeferred.isCompleted) readyDeferred.complete(true)
                        }
                        return
                    } else {
                        diagJson.put("notificationsStatus", "NO_CCCD_DESCRIPTOR")
                    }
                } else {
                    diagJson.put("notificationsStatus", "NO_NOTIFY_CHAR")
                }

                diagJson.put("state", "READY")
                x6hStateMap[macAddress] = X6hPrinterState.READY
                Log.i(TAG, "X6H: Driver is fully READY for $devName ($macAddress)")
                if (!readyDeferred.isCompleted) readyDeferred.complete(true)
            }

            override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
                lastGattStatusMap[macAddress] = status
                Log.i(TAG, "X6H onDescriptorWrite: descriptor=${descriptor.uuid}, status=$status (${getGattStatusDescription(status)})")
                val deferred = pendingDescriptorDeferreds.remove(macAddress)
                deferred?.complete(status == BluetoothGatt.GATT_SUCCESS)
            }

            override fun onCharacteristicWrite(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
                lastGattStatusMap[macAddress] = status
                val desc = getGattStatusDescription(status)
                Log.d(TAG, "X6H onCharacteristicWrite: char=${characteristic.uuid}, status=$status ($desc)")

                val deferred = pendingWriteDeferreds.remove(macAddress)
                if (status == BluetoothGatt.GATT_SUCCESS) {
                    deferred?.complete(GattWriteResult(success = true, statusCode = status, statusDescription = desc, writeTypeUsed = characteristic.writeType))
                } else {
                    Log.e(TAG, "X6H onCharacteristicWrite FAILED: status=$status ($desc)")
                    deferred?.complete(GattWriteResult(success = false, statusCode = status, statusDescription = desc, writeTypeUsed = characteristic.writeType, errorMessage = "GATT write failed with status $status ($desc)"))
                }
            }

            @Deprecated("Deprecated in Java")
            override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
                @Suppress("DEPRECATION")
                val data = characteristic.value ?: return
                handleX6hNotifyBytes(macAddress, data)
            }

            override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
                handleX6hNotifyBytes(macAddress, value)
            }
        }

        // Connect GATT with TRANSPORT_LE for explicit BLE
        val gatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
        } else {
            device.connectGatt(context, false, gattCallback)
        }
        activeGatts[macAddress] = gatt

        val isReady = try {
            withTimeout(8000L) {
                readyDeferred.await()
            }
        } catch (e: Exception) {
            Log.e(TAG, "X6H: connection timeout: ${e.message}")
            false
        }

        if (!isReady || x6hStateMap[macAddress] != X6hPrinterState.READY) {
            val lastStatus = lastGattStatusMap[macAddress] ?: -1
            disconnect(macAddress)
            result.put("success", false)
            result.put("status", "OFFLINE")
            result.put("gattStatus", lastStatus)
            result.put("gattStatusDesc", getGattStatusDescription(lastStatus))
            result.put("error", "Could not establish X6h BLE GATT channel (Status: $lastStatus - ${getGattStatusDescription(lastStatus)}). Ensure printer is powered on and within range.")
            return result
        }

        val finalMtu = activeMtuMap[macAddress] ?: 23
        result.put("success", true)
        result.put("status", "READY")
        result.put("transport", "BLE_GATT")
        result.put("protocol", "X6H_BLE")
        result.put("name", devName)
        result.put("address", macAddress)
        result.put("mtu", finalMtu)
        result.put("diagnostic", diagJson)
        result.put("message", "X6h BLE thermal printer connected, services discovered, and READY.")
        return result
    }

    /**
     * Generic BLE GATT Connection Routine for non-X6 thermal receipt printers
     */
    @SuppressLint("MissingPermission")
    private suspend fun connectGenericBleGatt(device: BluetoothDevice, devName: String): JSONObject {
        val result = JSONObject()
        val macAddress = device.address
        val completer = CompletableDeferred<Boolean>()

        val gattCallback = object : BluetoothGattCallback() {
            override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    activeGatts[macAddress] = gatt
                    gatt.discoverServices()
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    activeGatts.remove(macAddress)
                    activeGattWriteChars.remove(macAddress)
                    try { gatt.close() } catch (e: Exception) {}
                    if (!completer.isCompleted) completer.complete(false)
                }
            }

            override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
                if (status == BluetoothGatt.GATT_SUCCESS) {
                    var foundChar: BluetoothGattCharacteristic? = null
                    for (service in gatt.services) {
                        for (ch in service.characteristics) {
                            val props = ch.properties
                            val isWritable = (props and BluetoothGattCharacteristic.PROPERTY_WRITE != 0) ||
                                             (props and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE != 0)
                            val uuidLower = ch.uuid.toString().lowercase()
                            if (isWritable && KNOWN_GENERIC_BLE_WRITE_UUIDS.any { uuidLower.contains(it) }) {
                                foundChar = ch
                                break
                            }
                        }
                        if (foundChar != null) break
                    }

                    if (foundChar == null) {
                        for (service in gatt.services) {
                            for (ch in service.characteristics) {
                                val props = ch.properties
                                val isWritable = (props and BluetoothGattCharacteristic.PROPERTY_WRITE != 0) ||
                                                 (props and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE != 0)
                                if (isWritable) {
                                    foundChar = ch
                                    break
                                }
                            }
                            if (foundChar != null) break
                        }
                    }

                    if (foundChar != null) {
                        activeGattWriteChars[macAddress] = foundChar
                        val writeType = if ((foundChar.properties and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0) {
                            BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                        } else {
                            BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                        }
                        activeGattWriteType[macAddress] = writeType
                        if (!completer.isCompleted) completer.complete(true)
                    } else {
                        if (!completer.isCompleted) completer.complete(false)
                    }
                } else {
                    if (!completer.isCompleted) completer.complete(false)
                }
            }
        }

        val gatt = device.connectGatt(context, false, gattCallback)
        activeGatts[macAddress] = gatt

        val success = try {
            withTimeout(5000L) { completer.await() }
        } catch (e: Exception) {
            activeGattWriteChars[macAddress] != null
        }

        if (!success) {
            disconnect(macAddress)
            result.put("success", false)
            result.put("status", "OFFLINE")
            result.put("error", "Could not connect to $devName via RFCOMM or BLE GATT.")
            return result
        }

        result.put("success", true)
        result.put("status", "ONLINE")
        result.put("transport", "BLE_GATT")
        result.put("protocol", "ESC_POS")
        result.put("name", devName)
        result.put("address", macAddress)
        result.put("message", "Connected successfully to $devName via generic BLE GATT.")
        return result
    }

    private fun handleX6hNotifyBytes(macAddress: String, data: ByteArray) {
        if (data.isEmpty()) return
        val hex = data.joinToString(" ") { "%02X".format(it) }
        Log.i(TAG, "X6H NOTIFY received from $macAddress: [$hex] (${data.size} bytes)")

        if (data.size >= 4 && data[0] == 0x51.toByte() && data[1] == 0x78.toByte()) {
            val cmd = data[2].toInt() and 0xFF
            Log.d(TAG, "X6H ACK for Command: 0x%02X".format(cmd))
            if (cmd == 0xA3) { // Status response
                val isPaperPresent = if (data.size > 6) (data[6].toInt() and 0x01) == 0 else true
                if (!isPaperPresent) {
                    x6hStateMap[macAddress] = X6hPrinterState.PAPER_OUT
                    Log.w(TAG, "X6H: PAPER OUT detected on $macAddress")
                }
            }
        }
    }

    fun disconnect(macAddress: String) {
        try {
            activeSockets.remove(macAddress)?.close()
            activeStreams.remove(macAddress)?.close()
            val gatt = activeGatts.remove(macAddress)
            activeGattWriteChars.remove(macAddress)
            activeGattNotifyChars.remove(macAddress)
            activeGattWriteType.remove(macAddress)
            pendingWriteDeferreds.remove(macAddress)?.complete(GattWriteResult(false, errorMessage = "Disconnected"))
            pendingDescriptorDeferreds.remove(macAddress)?.complete(false)
            if (gatt != null) {
                try {
                    gatt.disconnect()
                    gatt.close()
                } catch (e: Exception) {}
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error disconnecting $macAddress: ${e.message}")
        }
        x6hStateMap[macAddress] = X6hPrinterState.DISCONNECTED
    }

    // -------------------------------------------------------------
    // Diagnostic APIs (TEST A, TEST B, TEST C)
    // -------------------------------------------------------------

    /**
     * TEST A: Comprehensive BLE Diagnostic
     * Connects, discovers all services, inspects all characteristics, checks properties & MTU
     */
    suspend fun getGattDiagnosticJson(targetAddress: String): JSONObject = withContext(Dispatchers.IO) {
        val device = resolveBluetoothDevice(targetAddress)
        val macAddress = device?.address ?: targetAddress

        if (!isDeviceConnected(macAddress)) {
            val conn = connect(macAddress)
            if (!conn.optBoolean("success", false)) {
                return@withContext JSONObject().apply {
                    put("success", false)
                    put("mac", macAddress)
                    put("error", conn.optString("error", "GATT connection failed"))
                }
            }
        }

        val diag = diagnosticInfoMap[macAddress] ?: JSONObject().apply {
            put("mac", macAddress)
            put("device", device?.name ?: "Unknown")
            put("state", getX6hState(macAddress).name)
            put("mtu", activeMtuMap[macAddress] ?: 23)
        }

        JSONObject().apply {
            put("success", true)
            put("diagnostic", diag)
        }
    }

    /**
     * TEST B: Minimal BLE 1-Packet Write Test (Task 7 & Task 14)
     * Sends ONE single small valid packet (Set Energy 0xAF: 10 bytes) to verify GATT write handshake
     */
    suspend fun testBleWrite(targetAddress: String): JSONObject = withContext(Dispatchers.IO) {
        val result = JSONObject()
        val device = resolveBluetoothDevice(targetAddress)
        val macAddress = device?.address ?: targetAddress

        if (!isDeviceConnected(macAddress)) {
            Log.i(TAG, "TEST B: Auto-connecting to $macAddress before 1-packet test...")
            val conn = connect(macAddress)
            if (!conn.optBoolean("success", false)) {
                result.put("success", false)
                result.put("test", "TEST_B_BLE_WRITE")
                result.put("error", "Connection failed: ${conn.optString("error")}")
                return@withContext result
            }
        }

        val gatt = activeGatts[macAddress]
        val writeChar = activeGattWriteChars[macAddress]

        if (gatt == null || writeChar == null) {
            result.put("success", false)
            result.put("test", "TEST_B_BLE_WRITE")
            result.put("error", "X6h BLE GATT channel is not ready. Write characteristic missing.")
            return@withContext result
        }

        val mutex = gattWriteMutexes.getOrPut(macAddress) { Mutex() }

        // Construct 1 minimal valid X6h packet: Set Energy (0xAF) to 12000 (0x2EE0)
        val singleTestPacket = buildX6Packet(0xAF.toByte(), byteArrayOf(0xE0.toByte(), 0x2E.toByte()))
        Log.i(TAG, "TEST B: Transmitting 1 minimal packet (${singleTestPacket.size}B) to ${writeChar.uuid}")

        val writeRes: GattWriteResult = mutex.withLock {
            writeGattChunkWithAck(gatt, writeChar, singleTestPacket, macAddress)
        }

        if (writeRes.success) {
            Log.i(TAG, "TEST B PASSED: 1-packet BLE write accepted by Android GATT (${singleTestPacket.size}B)")
            result.put("success", true)
            result.put("test", "TEST_B_BLE_WRITE")
            result.put("statusCode", writeRes.statusCode)
            result.put("statusDescription", writeRes.statusDescription)
            result.put("writeType", if (writeRes.writeTypeUsed == BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE) "WRITE_NO_RESPONSE" else "WRITE_DEFAULT")
            result.put("bytesSent", singleTestPacket.size)
            result.put("characteristic", writeChar.uuid.toString())
            result.put("message", "TEST B SUCCESS: 1-packet BLE write (${singleTestPacket.size}B) successfully accepted by Android GATT (${writeRes.statusDescription}).")
        } else {
            Log.e(TAG, "TEST B FAILED: ${writeRes.errorMessage}")
            result.put("success", false)
            result.put("test", "TEST_B_BLE_WRITE")
            result.put("statusCode", writeRes.statusCode)
            result.put("statusDescription", writeRes.statusDescription)
            result.put("characteristic", writeChar.uuid.toString())
            result.put("error", "TEST B FAILED: ${writeRes.errorMessage}")
        }

        return@withContext result
    }

    // -------------------------------------------------------------
    // Print Dispatch Engine (X6h BLE Protocol vs Standard ESC/POS)
    // -------------------------------------------------------------

    /**
     * Unified print routine:
     * - Auto-routes to dedicated X6h BLE raster protocol if target is X6h / Cat printer
     * - Dispatches standard ESC/POS stream if target is classic POS-58 / X18 / generic thermal
     */
    suspend fun printRaw(targetAddress: String, data: ByteArray, protocolOverride: String? = null): JSONObject = withContext(Dispatchers.IO) {
        val result = JSONObject()
        val device = resolveBluetoothDevice(targetAddress)
        val macAddress = device?.address ?: targetAddress

        val overrideLower = protocolOverride?.lowercase() ?: ""
        val forceCat = overrideLower == "cat" || overrideLower == "x6" || overrideLower == "x6h" || overrideLower == "raster" || overrideLower == "x6h_ble"
        val forceEscPos = overrideLower == "escpos" || overrideLower == "esc_pos"
        val isCat = if (forceCat) true else if (forceEscPos) false else (isX6CatPrinter(macAddress) || isX6CatPacket(data))

        if (!isDeviceConnected(macAddress)) {
            Log.i(TAG, "Connection inactive. Auto-connecting to $macAddress (isX6=$isCat)...")
            val connRes = connect(macAddress)
            if (!connRes.optBoolean("success", false)) {
                result.put("success", false)
                result.put("error", "Bluetooth printer offline: ${connRes.optString("error")}")
                return@withContext result
            }
        }

        if (isCat) {
            return@withContext printX6hBleJob(macAddress, data)
        } else {
            return@withContext printEscPosJob(macAddress, data)
        }
    }

    /**
     * Complete X6h BLE 8-Step Printing Sequence (TEST C: Full Physical Print)
     */
    @SuppressLint("MissingPermission")
    private suspend fun printX6hBleJob(macAddress: String, data: ByteArray): JSONObject {
        val result = JSONObject()
        val gatt = activeGatts[macAddress]
        val writeChar = activeGattWriteChars[macAddress]

        if (gatt == null || writeChar == null) {
            result.put("success", false)
            result.put("error", "X6h BLE GATT channel is not ready. Reconnect to printer.")
            return result
        }

        val mutex = gattWriteMutexes.getOrPut(macAddress) { Mutex() }

        try {
            x6hStateMap[macAddress] = X6hPrinterState.PRINTING
            Log.i(TAG, "X6H: Starting physical print job on $macAddress (char=${writeChar.uuid})")

            val packetsToSend: List<ByteArray> = if (isX6CatPacket(data)) {
                listOf(data)
            } else {
                val receiptText = extractTextFromEscPos(data)
                val bitmap = renderReceiptBitmap(receiptText)
                buildX6hPrintSequence(bitmap)
            }

            val negotiatedMtu = activeMtuMap[macAddress] ?: 23
            val maxPayloadPerWrite = maxOf(20, minOf(negotiatedMtu - 3, 244))
            Log.i(TAG, "X6H: MTU=$negotiatedMtu, writeChunkSize=$maxPayloadPerWrite, totalPackets=${packetsToSend.size}")

            var totalBytesWritten = 0
            var chunkIndex = 0

            mutex.withLock {
                for ((pktIdx, packet) in packetsToSend.withIndex()) {
                    var offset = 0
                    while (offset < packet.size) {
                        val len = minOf(maxPayloadPerWrite, packet.size - offset)
                        val chunk = ByteArray(len)
                        System.arraycopy(packet, offset, chunk, 0, len)
                        chunkIndex++

                        val writeRes = writeGattChunkWithAck(gatt, writeChar, chunk, macAddress)
                        if (!writeRes.success) {
                            Log.w(TAG, "X6H: Retry write on chunk $chunkIndex due to ${writeRes.errorMessage}")
                            delay(50)
                            val retryRes = writeGattChunkWithAck(gatt, writeChar, chunk, macAddress)
                            if (!retryRes.success) {
                                throw IOException("GATT write failed at packet $pktIdx, offset $offset (Status: ${retryRes.statusCode} - ${retryRes.statusDescription}) [${retryRes.errorMessage}]")
                            }
                        }

                        offset += len
                        totalBytesWritten += len
                        delay(12)
                    }
                    delay(15)
                }
            }

            x6hStateMap[macAddress] = X6hPrinterState.COMPLETED
            Log.i(TAG, "X6H: Physical print job successfully completed ($totalBytesWritten bytes transmitted)")

            result.put("success", true)
            result.put("status", "COMPLETED")
            result.put("bytesPrinted", totalBytesWritten)
            result.put("protocol", "X6H_BLE")
            result.put("transport", "BLE_GATT")
            result.put("message", "X6h BLE print job completed successfully ($totalBytesWritten bytes transmitted).")
            return result
        } catch (e: Exception) {
            x6hStateMap[macAddress] = X6hPrinterState.ERROR
            Log.e(TAG, "X6H: Print job error on $macAddress: ${e.message}")
            result.put("success", false)
            result.put("error", "X6h transmission failed: ${e.localizedMessage}")
            return result
        }
    }

    /**
     * Prints a pre-rendered monochrome Bitmap directly to the X6h BLE printer
     */
    suspend fun printX6hBitmap(targetAddress: String, bitmap: Bitmap): JSONObject = withContext(Dispatchers.IO) {
        val result = JSONObject()
        val device = resolveBluetoothDevice(targetAddress)
        val macAddress = device?.address ?: targetAddress

        if (!isDeviceConnected(macAddress)) {
            val connRes = connect(macAddress)
            if (!connRes.optBoolean("success", false)) {
                result.put("success", false)
                result.put("error", "X6h printer offline: ${connRes.optString("error")}")
                return@withContext result
            }
        }

        val packets = buildX6hPrintSequence(bitmap)
        val gatt = activeGatts[macAddress]
        val writeChar = activeGattWriteChars[macAddress]

        if (gatt == null || writeChar == null) {
            result.put("success", false)
            result.put("error", "X6h BLE GATT channel is not ready. Reconnect to printer.")
            return@withContext result
        }

        val mutex = gattWriteMutexes.getOrPut(macAddress) { Mutex() }

        try {
            x6hStateMap[macAddress] = X6hPrinterState.PRINTING
            Log.i(TAG, "X6H: Starting bitmap print job on $macAddress (${packets.size} packets)")

            val negotiatedMtu = activeMtuMap[macAddress] ?: 23
            val maxPayloadPerWrite = maxOf(20, minOf(negotiatedMtu - 3, 244))

            var totalBytesWritten = 0
            var chunkIndex = 0

            mutex.withLock {
                for ((pktIdx, packet) in packets.withIndex()) {
                    var offset = 0
                    while (offset < packet.size) {
                        val len = minOf(maxPayloadPerWrite, packet.size - offset)
                        val chunk = ByteArray(len)
                        System.arraycopy(packet, offset, chunk, 0, len)
                        chunkIndex++

                        val writeRes = writeGattChunkWithAck(gatt, writeChar, chunk, macAddress)
                        if (!writeRes.success) {
                            Log.w(TAG, "X6H: Retry write on chunk $chunkIndex due to ${writeRes.errorMessage}")
                            delay(50)
                            val retryRes = writeGattChunkWithAck(gatt, writeChar, chunk, macAddress)
                            if (!retryRes.success) {
                                throw IOException("GATT write failed at packet $pktIdx, offset $offset (Status: ${retryRes.statusCode} - ${retryRes.statusDescription}) [${retryRes.errorMessage}]")
                            }
                        }

                        offset += len
                        totalBytesWritten += len
                        delay(12)
                    }
                    delay(15)
                }
            }

            x6hStateMap[macAddress] = X6hPrinterState.COMPLETED
            Log.i(TAG, "X6H: Bitmap print job completed ($totalBytesWritten bytes transmitted)")

            result.put("success", true)
            result.put("status", "COMPLETED")
            result.put("bytesPrinted", totalBytesWritten)
            result.put("protocol", "X6H_BLE")
            result.put("transport", "BLE_GATT")
            result.put("message", "X6h BLE bitmap print job completed successfully ($totalBytesWritten bytes transmitted).")
            return@withContext result
        } catch (e: Exception) {
            x6hStateMap[macAddress] = X6hPrinterState.ERROR
            Log.e(TAG, "X6H: Bitmap print error on $macAddress: ${e.message}")
            result.put("success", false)
            result.put("error", "X6h transmission failed: ${e.localizedMessage}")
            return@withContext result
        }
    }

    /**
     * Dedicated Standard ESC/POS Print Routine
     */
    private suspend fun printEscPosJob(macAddress: String, data: ByteArray): JSONObject {
        val result = JSONObject()
        val stream = activeStreams[macAddress]
        val gatt = activeGatts[macAddress]
        val writeChar = activeGattWriteChars[macAddress]

        val bytesToSend = prepareEscPosBytes(data)

        // Pathway A: Classic RFCOMM OutputStream
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
                result.put("protocol", "ESC_POS")
                result.put("transport", "CLASSIC_RFCOMM")
                result.put("message", "Receipt transmitted successfully via RFCOMM.")
                return result
            } catch (e: Exception) {
                Log.w(TAG, "RFCOMM write error to $macAddress: ${e.message}. Attempting BLE fallback...")
                disconnect(macAddress)
            }
        }

        // Pathway B: Generic BLE GATT Write
        if (gatt != null && writeChar != null) {
            try {
                val bleChunkSize = 20
                var offset = 0
                var totalWritten = 0
                while (offset < bytesToSend.size) {
                    val len = minOf(bleChunkSize, bytesToSend.size - offset)
                    val chunk = ByteArray(len)
                    System.arraycopy(bytesToSend, offset, chunk, 0, len)
                    val writeRes = writeGattChunkWithAck(gatt, writeChar, chunk, macAddress)
                    if (!writeRes.success) {
                        delay(25)
                        writeGattChunkWithAck(gatt, writeChar, chunk, macAddress)
                    }
                    offset += len
                    totalWritten += len
                    delay(15)
                }

                result.put("success", true)
                result.put("bytesPrinted", totalWritten)
                result.put("protocol", "ESC_POS")
                result.put("transport", "BLE_GATT")
                result.put("message", "Receipt transmitted successfully via BLE GATT.")
                return result
            } catch (bleErr: Exception) {
                Log.e(TAG, "BLE GATT write failed to $macAddress: ${bleErr.message}")
            }
        }

        result.put("success", false)
        result.put("error", "No active connection available for $macAddress. Verify printer is paired and powered on.")
        return result
    }

    /**
     * Performs a single GATT characteristic write with dynamic write-type support, status tracking, and fallback
     */
    @SuppressLint("MissingPermission")
    private suspend fun writeGattChunkWithAck(
        gatt: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
        chunk: ByteArray,
        macAddress: String
    ): GattWriteResult {
        val props = characteristic.properties
        val canWriteDefault = (props and BluetoothGattCharacteristic.PROPERTY_WRITE) != 0
        val canWriteNoResp = (props and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0

        if (!canWriteDefault && !canWriteNoResp) {
            return GattWriteResult(
                success = false,
                errorMessage = "Characteristic ${characteristic.uuid} has no WRITE or WRITE_NO_RESPONSE property (props=$props: [${getPropertyStrings(props).joinToString(", ")}])"
            )
        }

        // Primary Write Type selection
        val preferredType = activeGattWriteType[macAddress] ?: if (canWriteNoResp) {
            BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
        } else {
            BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        }

        val primaryResult = executeSingleGattWrite(gatt, characteristic, chunk, macAddress, preferredType)
        if (primaryResult.success) {
            return primaryResult
        }

        // Fallback to alternate write type if supported and primary failed
        val alternateType = if (preferredType == BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT && canWriteNoResp) {
            BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
        } else if (preferredType == BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE && canWriteDefault) {
            BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        } else {
            null
        }

        if (alternateType != null) {
            Log.w(TAG, "X6H: Primary write type failed (${primaryResult.statusDescription}). Attempting fallback to alternate write type ($alternateType)...")
            delay(30)
            val fallbackResult = executeSingleGattWrite(gatt, characteristic, chunk, macAddress, alternateType)
            if (fallbackResult.success) {
                activeGattWriteType[macAddress] = alternateType
                Log.i(TAG, "X6H: Fallback write type SUCCESS. Updated preferred write type to $alternateType.")
                return fallbackResult
            }
        }

        return primaryResult
    }

    @SuppressLint("MissingPermission")
    private suspend fun executeSingleGattWrite(
        gatt: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
        chunk: ByteArray,
        macAddress: String,
        writeType: Int
    ): GattWriteResult {
        val deferred = if (writeType == BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) {
            CompletableDeferred<GattWriteResult>().also { pendingWriteDeferreds[macAddress] = it }
        } else {
            null
        }

        val writeInitiatedStatus: Int = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            gatt.writeCharacteristic(characteristic, chunk, writeType)
        } else {
            @Suppress("DEPRECATION")
            characteristic.value = chunk
            @Suppress("DEPRECATION")
            characteristic.writeType = writeType
            @Suppress("DEPRECATION")
            val ok = gatt.writeCharacteristic(characteristic)
            if (ok) 0 else -1
        }

        val writeTypeStr = if (writeType == BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE) "WRITE_NO_RESPONSE" else "WRITE_DEFAULT"
        Log.d(TAG, "X6H executeSingleGattWrite: char=${characteristic.uuid}, len=${chunk.size}B, writeType=$writeTypeStr, writeInitiatedStatus=$writeInitiatedStatus")

        if (writeInitiatedStatus != 0) {
            pendingWriteDeferreds.remove(macAddress)
            val desc = getGattStatusDescription(writeInitiatedStatus)
            return GattWriteResult(
                success = false,
                statusCode = writeInitiatedStatus,
                statusDescription = desc,
                writeTypeUsed = writeType,
                errorMessage = "GATT write initiation rejected with code $writeInitiatedStatus ($desc) on $writeTypeStr"
            )
        }

        // For WRITE_TYPE_DEFAULT: Await onCharacteristicWrite acknowledgment
        if (deferred != null) {
            return try {
                withTimeout(2500L) {
                    deferred.await()
                }
            } catch (e: Exception) {
                pendingWriteDeferreds.remove(macAddress)
                val lastStatus = lastGattStatusMap[macAddress] ?: -1
                GattWriteResult(
                    success = false,
                    statusCode = lastStatus,
                    statusDescription = getGattStatusDescription(lastStatus),
                    writeTypeUsed = writeType,
                    errorMessage = "GATT write timeout waiting for onCharacteristicWrite ACK (Last status: $lastStatus - ${getGattStatusDescription(lastStatus)})"
                )
            }
        }

        // For WRITE_TYPE_NO_RESPONSE: Enforce safe inter-packet pacing
        delay(12L)
        return GattWriteResult(
            success = true,
            statusCode = BluetoothGatt.GATT_SUCCESS,
            statusDescription = "SUCCESS",
            writeTypeUsed = writeType,
            bytesWritten = chunk.size
        )
    }

    // -------------------------------------------------------------
    // X6h Packet Protocol & Bitmap Encoder
    // -------------------------------------------------------------

    /**
     * Builds the complete 8-step X6h print sequence from a monochrome bitmap
     */
    fun buildX6hPrintSequence(bitmap: Bitmap): List<ByteArray> {
        val packets = mutableListOf<ByteArray>()

        // 1. Initialize: Lattice Start (0xA6)
        Log.d(TAG, "X6H: sending initialize (lattice start 0xA6)")
        val latticeStartPayload = byteArrayOf(
            0xAA.toByte(), 0x55.toByte(), 0x17.toByte(), 0x38.toByte(), 0x44.toByte(),
            0x5F.toByte(), 0x5F.toByte(), 0x5F.toByte(), 0x44.toByte(), 0x38.toByte(), 0x2C.toByte()
        )
        packets.add(buildX6Packet(0xA6.toByte(), latticeStartPayload))

        // 2. Set Print Energy (0xAF): Safe default 12000 (0x2EE0) in Little Endian: [0xE0, 0x2E]
        Log.d(TAG, "X6H: setting energy (0xAF: 12000 / 0x2EE0)")
        packets.add(buildX6Packet(0xAF.toByte(), byteArrayOf(0xE0.toByte(), 0x2E.toByte())))

        // 3. Set Print Quality (0xA4) & Speed (0xBD)
        Log.d(TAG, "X6H: setting quality & speed (0xA4, 0xBD)")
        packets.add(buildX6Packet(0xA4.toByte(), byteArrayOf(0x33.toByte())))
        packets.add(buildX6Packet(0xBD.toByte(), byteArrayOf(0x19.toByte())))

        // 4. Enter Image / Raster Mode (0xBE with 0x00 for images)
        Log.d(TAG, "X6H: entering image drawing mode (0xBE: 0x00)")
        packets.add(buildX6Packet(0xBE.toByte(), byteArrayOf(0x00.toByte())))

        // 5. Send Image Data (0xA2 with 48 bytes per line, 384 dots, LSB-FIRST bit packing)
        Log.d(TAG, "X6H: sending image (${bitmap.height} rows)")
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
                            // LSB-FIRST bit packing (bit 0 is leftmost pixel)
                            b = b or (1 shl bit)
                        }
                    }
                }
                rowBytes[byteIdx] = b.toByte()
            }
            packets.add(buildX6Packet(0xA2.toByte(), rowBytes))
        }

        // 6. Finish Image Transmission: Lattice End (0xA6)
        Log.d(TAG, "X6H: finishing image transmission (lattice end 0xA6)")
        val latticeEndPayload = byteArrayOf(
            0xAA.toByte(), 0x55.toByte(), 0x17.toByte(), 0x00.toByte(), 0x00.toByte(),
            0x00.toByte(), 0x00.toByte(), 0x00.toByte(), 0x00.toByte(), 0x00.toByte(), 0x17.toByte()
        )
        packets.add(buildX6Packet(0xA6.toByte(), latticeEndPayload))

        // 7. Feed Paper (0xA1: 100 steps)
        Log.d(TAG, "X6H: feeding paper (0xA1: 100 steps)")
        packets.add(buildX6Packet(0xA1.toByte(), byteArrayOf(100.toByte(), 0.toByte())))

        return packets
    }

    /**
     * Dedicated hardware test print bitmap generation for X6h
     */
    fun createX6hTestPrintBitmap(): Bitmap {
        val width = 384
        val height = 240
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.WHITE)

        val textPaint = Paint().apply {
            color = Color.BLACK
            textSize = 22f
            typeface = Typeface.create(Typeface.MONOSPACE, Typeface.NORMAL)
            isAntiAlias = false
        }
        val headerPaint = Paint(textPaint).apply {
            textSize = 24f
            isFakeBoldText = true
        }

        val padding = 16f
        var y = 36f

        fun drawCentered(text: String, paint: Paint) {
            val textW = paint.measureText(text)
            val x = (width - textW) / 2f
            canvas.drawText(text, maxOf(0f, x), y, paint)
            y += 28f
        }

        drawCentered("========================", headerPaint)
        drawCentered("AURAPOS TEST PRINT", headerPaint)
        drawCentered("========================", headerPaint)
        y += 4f

        canvas.drawText("Printer:  X6h-0000", padding, y, textPaint)
        y += 26f
        canvas.drawText("Protocol: X6H BLE", padding, y, textPaint)
        y += 26f
        canvas.drawText("BLE:      CONNECTED", padding, y, textPaint)
        y += 26f
        canvas.drawText("PRINT TEST: OK", padding, y, textPaint)
        y += 28f

        drawCentered("========================", headerPaint)

        return bitmap
    }

    /**
     * Renders arbitrary receipt text to a high-contrast 384-dot monochrome bitmap
     */
    fun renderReceiptBitmap(text: String): Bitmap {
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

    private fun prepareEscPosBytes(data: ByteArray): ByteArray {
        val out = ArrayList<Byte>(data.size + 32)

        if (data.size < 2 || data[0] != 0x1B.toByte() || data[1] != 0x40.toByte()) {
            out.add(0x1B)
            out.add(0x40)
        }

        var i = 0
        while (i < data.size) {
            val b = data[i]
            val bInt = b.toInt() and 0xFF

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
                if (out.isEmpty() || out[out.size - 1] != 0x0D.toByte()) {
                    out.add(0x0D)
                }
                out.add(0x0A)
            } else {
                out.add(b)
            }
            i++
        }

        for (k in 0 until 4) {
            out.add(0x0D)
            out.add(0x0A)
        }

        return out.toByteArray()
    }

    fun cleanup() {
        try {
            context.unregisterReceiver(discoveryReceiver)
        } catch (e: Exception) {}
        stopScan()
        activeSockets.keys.toList().forEach { disconnect(it) }
        activeGatts.keys.toList().forEach { disconnect(it) }
    }

    companion object {
        private const val TAG = "BluetoothPrinterManager"

        fun isX6CatPacket(data: ByteArray): Boolean {
            return data.size >= 2 && data[0] == 0x51.toByte() && data[1] == 0x78.toByte()
        }

        fun getPropertyStrings(properties: Int): List<String> {
            val list = mutableListOf<String>()
            if ((properties and BluetoothGattCharacteristic.PROPERTY_BROADCAST) != 0) list.add("BROADCAST")
            if ((properties and BluetoothGattCharacteristic.PROPERTY_READ) != 0) list.add("READ")
            if ((properties and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0) list.add("WRITE_NO_RESPONSE")
            if ((properties and BluetoothGattCharacteristic.PROPERTY_WRITE) != 0) list.add("WRITE")
            if ((properties and BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0) list.add("NOTIFY")
            if ((properties and BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0) list.add("INDICATE")
            if ((properties and BluetoothGattCharacteristic.PROPERTY_SIGNED_WRITE) != 0) list.add("SIGNED_WRITE")
            if ((properties and BluetoothGattCharacteristic.PROPERTY_EXTENDED_PROPS) != 0) list.add("EXTENDED_PROPS")
            return if (list.isEmpty()) listOf("NONE") else list
        }

        fun getGattStatusDescription(status: Int): String {
            return when (status) {
                BluetoothGatt.GATT_SUCCESS -> "GATT_SUCCESS (0)"
                BluetoothGatt.GATT_READ_NOT_PERMITTED -> "GATT_READ_NOT_PERMITTED (2)"
                BluetoothGatt.GATT_WRITE_NOT_PERMITTED -> "GATT_WRITE_NOT_PERMITTED (3)"
                BluetoothGatt.GATT_INSUFFICIENT_AUTHENTICATION -> "GATT_INSUFFICIENT_AUTHENTICATION (5)"
                BluetoothGatt.GATT_REQUEST_NOT_SUPPORTED -> "GATT_REQUEST_NOT_SUPPORTED (6)"
                BluetoothGatt.GATT_INVALID_OFFSET -> "GATT_INVALID_OFFSET (7)"
                BluetoothGatt.GATT_INVALID_ATTRIBUTE_LENGTH -> "GATT_INVALID_ATTRIBUTE_LENGTH (13)"
                BluetoothGatt.GATT_INSUFFICIENT_ENCRYPTION -> "GATT_INSUFFICIENT_ENCRYPTION (15)"
                128 -> "GATT_NO_RESOURCES (128)"
                133 -> "GATT_ERROR_133 (Connection congested / stack timeout)"
                200 -> "ERROR_GATT_WRITE_NOT_ALLOWED (200)"
                201 -> "ERROR_GATT_WRITE_REQUEST_BUSY (201)"
                257 -> "GATT_FAILURE (257)"
                -1 -> "GATT_WRITE_FAILED (-1)"
                else -> "GATT_STATUS_$status"
            }
        }

        /*
         * Standard CRC-8 Algorithm for 0x5178 Protocol (Polynomial 0x07, Init 0x00)
         */
        fun crc8(data: ByteArray): Byte {
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

        /*
         * Constructs a compliant X6h packet:
         * Header (0x51 0x78), Command, 0x00, Len_Low, Len_High, Payload, CRC8, 0xFF
         */
        fun buildX6Packet(cmd: Byte, payload: ByteArray): ByteArray {
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
    }
}
