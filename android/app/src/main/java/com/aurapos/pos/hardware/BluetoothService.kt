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
 * Native Android BluetoothService for AuraPOS
 * Handles scanning, pairing, and native connection to X18 Mini, X6h, and standard ESC/POS printers.
 * Ensures proper Bluetooth permissions requests and reflection/BLE fallback for microcontroller printers.
 */
class BluetoothService(private val context: Context) {

    private val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    private val bluetoothAdapter: BluetoothAdapter?
        get() = bluetoothManager?.adapter ?: BluetoothAdapter.getDefaultAdapter()

    private val activeSockets = ConcurrentHashMap<String, BluetoothSocket>()
    private val activeStreams = ConcurrentHashMap<String, OutputStream>()
    private val activeGatts = ConcurrentHashMap<String, BluetoothGatt>()
    private val activeGattWriteChars = ConcurrentHashMap<String, BluetoothGattCharacteristic>()

    private val discoveredDevices = ConcurrentHashMap<String, BluetoothDevice>()
    private var isScanning = false
    private var discoveryListener: ((String) -> Unit)? = null

    private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    private val KNOWN_BLE_WRITE_UUIDS = listOf("0000ae01", "0000ffe1", "00002af1", "0000ff02", "0000fee1")

    private val bluetoothReceiver = object : BroadcastReceiver() {
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
                BluetoothDevice.ACTION_BOND_STATE_CHANGED -> {
                    notifyDevicesUpdated()
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
            addAction(BluetoothDevice.ACTION_BOND_STATE_CHANGED)
            addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED)
            addAction(BluetoothAdapter.ACTION_STATE_CHANGED)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(bluetoothReceiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            context.registerReceiver(bluetoothReceiver, filter)
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
    fun startScan(listener: (String) -> Unit): String {
        val adapter = bluetoothAdapter
        if (adapter == null) {
            return JSONObject().apply {
                put("success", false)
                put("error", "Bluetooth not supported on this device.")
            }.toString()
        }

        if (!adapter.isEnabled) {
            return JSONObject().apply {
                put("success", false)
                put("bluetoothDisabled", true)
                put("error", "Bluetooth is disabled.")
            }.toString()
        }

        if (!hasPermissions()) {
            return JSONObject().apply {
                put("success", false)
                put("permissionDenied", true)
                put("error", "Bluetooth permissions required.")
            }.toString()
        }

        discoveryListener = listener
        discoveredDevices.clear()

        try {
            adapter.bondedDevices?.forEach { device ->
                if (device.address != null) {
                    discoveredDevices[device.address] = device
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error querying bonded: ${e.message}")
        }

        try {
            if (adapter.isDiscovering) {
                adapter.cancelDiscovery()
            }
            isScanning = adapter.startDiscovery()
            notifyDevicesUpdated()

            return JSONObject().apply {
                put("success", true)
                put("isScanning", isScanning)
            }.toString()
        } catch (e: Exception) {
            return JSONObject().apply {
                put("success", false)
                put("error", e.message)
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
        discoveredDevices.values.forEach { device ->
            try {
                val address = device.address
                val isBonded = device.bondState == BluetoothDevice.BOND_BONDED
                val isConnected = (activeSockets[address]?.isConnected == true) || (activeGattWriteChars[address] != null)

                val obj = JSONObject().apply {
                    put("id", address)
                    put("name", device.name ?: "Printer (${address.takeLast(5)})")
                    put("address", address)
                    put("bonded", isBonded)
                    put("connected", isConnected)
                    put("type", "bluetooth")
                }
                array.put(obj)
            } catch (_: Exception) {}
        }
        return array.toString()
    }

    private fun notifyDevicesUpdated() {
        discoveryListener?.invoke(getDiscoveredDevicesJson())
    }

    fun isX6CatPrinter(macAddress: String): Boolean {
        val dev = discoveredDevices[macAddress] ?: try { bluetoothAdapter?.getRemoteDevice(macAddress) } catch (_: Exception) { null }
        val name = (dev?.name ?: "").lowercase()
        return name.startsWith("x6") || name.startsWith("x5") || name.startsWith("c9") ||
               name.startsWith("c15") || name.startsWith("cat") || name.startsWith("tiny") ||
               name.startsWith("walk") || name.contains("x6h") || name.contains("x6-")
    }

    @SuppressLint("MissingPermission")
    suspend fun connect(macAddress: String): JSONObject = withContext(Dispatchers.IO) {
        val result = JSONObject()
        val adapter = bluetoothAdapter

        if (adapter == null || !adapter.isEnabled) {
            result.put("success", false)
            result.put("status", "OFFLINE")
            result.put("error", "Bluetooth disabled.")
            return@withContext result
        }

        try {
            val device = adapter.getRemoteDevice(macAddress)
            val devName = try { device.name ?: macAddress } catch (_: Exception) { macAddress }

            disconnect(macAddress)

            var socketConnected = false

            // Connect BLE GATT in parallel
            try {
                device.connectGatt(context, false, object : BluetoothGattCallback() {
                    override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
                        if (newState == BluetoothProfile.STATE_CONNECTED) {
                            activeGatts[macAddress] = gatt
                            gatt.discoverServices()
                        } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                            activeGatts.remove(macAddress)
                            activeGattWriteChars.remove(macAddress)
                            try { gatt.close() } catch (_: Exception) {}
                        }
                    }

                    override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
                        if (status == BluetoothGatt.GATT_SUCCESS) {
                            for (service in gatt.services) {
                                for (characteristic in service.characteristics) {
                                    val properties = characteristic.properties
                                    val isWritable = (properties and BluetoothGattCharacteristic.PROPERTY_WRITE != 0) ||
                                                     (properties and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE != 0)
                                    val uuidLower = characteristic.uuid.toString().lowercase()
                                    if (isWritable && KNOWN_BLE_WRITE_UUIDS.any { uuidLower.contains(it) }) {
                                        activeGattWriteChars[macAddress] = characteristic
                                        break
                                    }
                                }
                            }
                        }
                    }
                })
            } catch (_: Exception) {}

            // Connect RFCOMM SPP
            var socket: BluetoothSocket? = null
            try {
                val s = device.createRfcommSocketToServiceRecord(SPP_UUID)
                withTimeout(4500L) { s.connect() }
                socket = s
                socketConnected = true
            } catch (_: Exception) {
                try {
                    val method = device.javaClass.getMethod("createRfcommSocket", Int::class.javaPrimitiveType)
                    val sFallback = method.invoke(device, 1) as BluetoothSocket
                    withTimeout(4500L) { sFallback.connect() }
                    socket = sFallback
                    socketConnected = true
                } catch (_: Exception) {}
            }

            if (socketConnected && socket != null && socket.isConnected) {
                activeSockets[macAddress] = socket
                activeStreams[macAddress] = socket.outputStream
                if (!isX6CatPrinter(macAddress)) {
                    socket.outputStream.write(byteArrayOf(0x1B, 0x40))
                    socket.outputStream.flush()
                }
            }

            result.put("success", true)
            result.put("status", "ONLINE")
            result.put("name", devName)
            result.put("address", macAddress)
        } catch (e: Exception) {
            disconnect(macAddress)
            result.put("success", false)
            result.put("status", "OFFLINE")
            result.put("error", e.message)
        }
        result
    }

    fun disconnect(macAddress: String) {
        try {
            activeStreams.remove(macAddress)?.close()
            activeSockets.remove(macAddress)?.close()
            activeGattWriteChars.remove(macAddress)
            activeGatts.remove(macAddress)?.close()
        } catch (_: Exception) {}
    }

    suspend fun printRaw(macAddress: String, data: ByteArray): JSONObject = withContext(Dispatchers.IO) {
        val result = JSONObject()
        val isCat = isX6CatPrinter(macAddress) || (data.size >= 2 && data[0] == 0x51.toByte() && data[1] == 0x78.toByte())

        if (isCat) {
            try {
                val text = extractText(data)
                val bitmap = renderBitmap(text)
                val packets = buildX6Packets(bitmap)

                val stream = activeStreams[macAddress]
                val gatt = activeGatts[macAddress]
                val writeChar = activeGattWriteChars[macAddress]

                for (packet in packets) {
                    if (stream != null) {
                        stream.write(packet)
                        stream.flush()
                    }
                    if (gatt != null && writeChar != null) {
                        var off = 0
                        while (off < packet.size) {
                            val chunkLen = minOf(20, packet.size - off)
                            val chunk = ByteArray(chunkLen)
                            System.arraycopy(packet, off, chunk, 0, chunkLen)
                            writeChar.value = chunk
                            writeChar.writeType = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                            @Suppress("DEPRECATION")
                            gatt.writeCharacteristic(writeChar)
                            off += chunkLen
                            delay(12)
                        }
                    }
                    delay(20)
                }
                result.put("success", true)
            } catch (e: Exception) {
                result.put("success", false)
                result.put("error", e.message)
            }
        } else {
            val stream = activeStreams[macAddress]
            if (stream == null) {
                result.put("success", false)
                result.put("error", "Stream not ready.")
                return@withContext result
            }
            try {
                stream.write(data)
                stream.write(byteArrayOf(0x0D, 0x0A, 0x1B, 0x64, 0x05, 0x0C))
                stream.flush()
                result.put("success", true)
            } catch (e: Exception) {
                result.put("success", false)
                result.put("error", e.message)
            }
        }
        result
    }

    private fun extractText(data: ByteArray): String {
        val sb = StringBuilder()
        for (b in data) {
            val v = b.toInt() and 0xFF
            if (v in 0x20..0x7E) {
                sb.append(v.toChar())
            } else if (v == 0x0A) {
                sb.append("\n")
            }
        }
        val t = sb.toString().trim()
        return if (t.isNotBlank()) t else "*** AURAPOS RECEIPT ***\nHardware Connected"
    }

    private fun renderBitmap(text: String): Bitmap {
        val width = 384
        val lines = text.split("\n")
        val paint = Paint().apply {
            color = Color.BLACK
            textSize = 22f
            typeface = Typeface.create(Typeface.MONOSPACE, Typeface.NORMAL)
        }
        val lineHeight = 30
        val height = maxOf(lineHeight * lines.size + 40, 80)
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.WHITE)
        var y = 30
        for (l in lines) {
            canvas.drawText(l.trim(), 12f, y.toFloat(), paint)
            y += lineHeight
        }
        return bitmap
    }

    private fun buildX6Packets(bitmap: Bitmap): List<ByteArray> {
        val list = mutableListOf<ByteArray>()
        // Lattice start
        list.add(byteArrayOf(0x51, 0x78, 0xA6.toByte(), 0, 0x0B, 0, 0xAA.toByte(), 0x55, 0x17, 0x38, 0x44, 0x5F, 0x5F, 0x5F, 0x44, 0x38, 0x2C, 0xA1.toByte(), 0xFF.toByte()))
        list.add(makePacket(0xAF.toByte(), byteArrayOf(0, 0xFF.toByte())))
        list.add(makePacket(0xA4.toByte(), byteArrayOf(0x33)))

        val width = 384
        val bytesPerRow = 48
        for (y in 0 until bitmap.height) {
            val row = ByteArray(bytesPerRow)
            for (bx in 0 until bytesPerRow) {
                var b = 0
                for (bit in 0 until 8) {
                    val x = bx * 8 + bit
                    if (x < bitmap.width && y < bitmap.height) {
                        val pix = bitmap.getPixel(x, y)
                        val r = (pix shr 16) and 0xFF
                        val g = (pix shr 8) and 0xFF
                        val bl = pix and 0xFF
                        if ((r * 299 + g * 587 + bl * 114) / 1000 < 128) {
                            b = b or (1 shl bit)
                        }
                    }
                }
                row[bx] = b.toByte()
            }
            list.add(makePacket(0xA2.toByte(), row))
        }

        // Lattice end
        list.add(byteArrayOf(0x51, 0x78, 0xA6.toByte(), 0, 0x0B, 0, 0xAA.toByte(), 0x55, 0x17, 0, 0, 0, 0, 0, 0, 0, 0x17, 0x11, 0xFF.toByte()))
        // Feed paper
        list.add(makePacket(0xA1.toByte(), byteArrayOf(70, 0)))
        return list
    }

    private fun makePacket(cmd: Byte, payload: ByteArray): ByteArray {
        var crc = 0
        for (b in payload) {
            crc = crc xor (b.toInt() and 0xFF)
            for (i in 0 until 8) {
                crc = if ((crc and 0x80) != 0) ((crc shl 1) xor 0x07) and 0xFF else (crc shl 1) and 0xFF
            }
        }
        val len = payload.size
        val packet = ByteArray(8 + len)
        packet[0] = 0x51
        packet[1] = 0x78
        packet[2] = cmd
        packet[3] = 0
        packet[4] = (len and 0xFF).toByte()
        packet[5] = ((len shr 8) and 0xFF).toByte()
        System.arraycopy(payload, 0, packet, 6, len)
        packet[6 + len] = crc.toByte()
        packet[7 + len] = 0xFF.toByte()
        return packet
    }

    fun cleanup() {
        try { context.unregisterReceiver(bluetoothReceiver) } catch (_: Exception) {}
        activeSockets.keys.toList().forEach { disconnect(it) }
    }

    companion object {
        private const val TAG = "BluetoothService"
    }
}
