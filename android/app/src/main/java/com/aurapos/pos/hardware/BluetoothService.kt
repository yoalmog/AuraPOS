package com.aurapos.pos.hardware

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
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
 * Handles scanning, pairing, and native connection to X18 Mini and standard ESC/POS printers.
 * Ensures proper Bluetooth permissions requests and reflection fallback for microcontroller printers.
 */
class BluetoothService(private val context: Context) {

    private val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    private val bluetoothAdapter: BluetoothAdapter? = bluetoothManager?.adapter

    // Active sockets and output streams indexed by MAC address
    private val activeSockets = ConcurrentHashMap<String, BluetoothSocket>()
    private val activeStreams = ConcurrentHashMap<String, OutputStream>()

    // Discovered devices map (MAC -> BluetoothDevice)
    private val discoveredDevices = ConcurrentHashMap<String, BluetoothDevice>()
    private var isScanning = false
    private var discoveryListener: ((String) -> Unit)? = null

    // Standard ESC/POS Serial Port Profile (SPP) UUID
    private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

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
        return bluetoothAdapter?.isEnabled == true
    }

    fun hasPermissions(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        }
    }

    /**
     * Start physical scanning for nearby Bluetooth thermal printers
     */
    @SuppressLint("MissingPermission")
    fun startScan(listener: (String) -> Unit): String {
        if (bluetoothAdapter == null) {
            return JSONObject().apply {
                put("success", false)
                put("error", "Bluetooth hardware not supported on this terminal.")
            }.toString()
        }

        if (!bluetoothAdapter.isEnabled) {
            return JSONObject().apply {
                put("success", false)
                put("bluetoothDisabled", true)
                put("error", "Bluetooth is disabled. Please enable Bluetooth in Android settings.")
            }.toString()
        }

        if (!hasPermissions()) {
            return JSONObject().apply {
                put("success", false)
                put("permissionDenied", true)
                put("error", "Bluetooth Scan and Connect permissions are required to discover printers.")
            }.toString()
        }

        discoveryListener = listener
        discoveredDevices.clear()

        // 1. Populate bonded devices immediately
        try {
            bluetoothAdapter.bondedDevices?.forEach { device ->
                if (device.address != null) {
                    discoveredDevices[device.address] = device
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error querying bonded devices: ${e.message}")
        }

        // 2. Start hardware discovery
        try {
            if (bluetoothAdapter.isDiscovering) {
                bluetoothAdapter.cancelDiscovery()
            }
            val started = bluetoothAdapter.startDiscovery()
            isScanning = started
            notifyDevicesUpdated()

            return JSONObject().apply {
                put("success", true)
                put("isScanning", started)
                put("message", "Bluetooth hardware scan started.")
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
                bluetoothAdapter.cancelDiscovery()
            }
        } catch (_: Exception) {}
        isScanning = false
    }

    /**
     * Initiate native OS Bluetooth pairing with target device
     */
    @SuppressLint("MissingPermission")
    fun pairDevice(macAddress: String): JSONObject {
        val result = JSONObject()
        if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled) {
            result.put("success", false)
            result.put("error", "Bluetooth is unavailable.")
            return result
        }

        try {
            val device = bluetoothAdapter.getRemoteDevice(macAddress)
            if (device.bondState == BluetoothDevice.BOND_BONDED) {
                result.put("success", true)
                result.put("bonded", true)
                result.put("message", "Device is already paired.")
                return result
            }

            val started = device.createBond()
            result.put("success", started)
            result.put("message", if (started) "Pairing request dispatched." else "Could not start pairing.")
        } catch (e: Exception) {
            result.put("success", false)
            result.put("error", e.message ?: "Pairing failed")
        }
        return result
    }

    /**
     * Connect to target Bluetooth printer via RFCOMM SPP socket.
     * Primary target: X18 Mini.
     */
    @SuppressLint("MissingPermission")
    suspend fun connect(macAddress: String): JSONObject = withContext(Dispatchers.IO) {
        val result = JSONObject()

        if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled) {
            result.put("success", false)
            result.put("status", "OFFLINE")
            result.put("error", "Bluetooth is disabled or unavailable.")
            return@withContext result
        }

        if (!hasPermissions()) {
            result.put("success", false)
            result.put("status", "OFFLINE")
            result.put("error", "Bluetooth Connect permission denied.")
            return@withContext result
        }

        // Stop scanning to preserve RFCOMM bandwidth
        stopScan()

        try {
            val device = bluetoothAdapter.getRemoteDevice(macAddress)
            val devName = try { device.name ?: "X18 Mini ($macAddress)" } catch (_: Exception) { "X18 Mini ($macAddress)" }

            disconnect(macAddress)

            Log.d(TAG, "Opening RFCOMM SPP socket to $devName ($macAddress)...")
            var socket: BluetoothSocket? = null

            // Strategy 1: Standard SPP UUID
            try {
                val s = device.createRfcommSocketToServiceRecord(SPP_UUID)
                withTimeout(5000L) {
                    s.connect()
                }
                socket = s
                Log.d(TAG, "Connected via standard SPP UUID.")
            } catch (sppError: Exception) {
                Log.w(TAG, "Standard SPP failed: ${sppError.message}. Using RFCOMM channel 1 reflection fallback...")
                try { socket?.close() } catch (_: Exception) {}

                // Strategy 2: Channel 1 reflection fallback for X18 Mini & generic thermal printers
                val method = device.javaClass.getMethod("createRfcommSocket", Int::class.javaPrimitiveType)
                val sFallback = method.invoke(device, 1) as BluetoothSocket
                withTimeout(5000L) {
                    sFallback.connect()
                }
                socket = sFallback
                Log.d(TAG, "Connected via channel 1 reflection fallback.")
            }

            if (socket == null || !socket.isConnected) {
                throw IOException("Could not establish RFCOMM socket.")
            }

            val outputStream = socket.outputStream
            activeSockets[macAddress] = socket
            activeStreams[macAddress] = outputStream

            // Handshake verification: ESC @ (Initialize printer)
            outputStream.write(byteArrayOf(0x1B, 0x40))
            outputStream.flush()

            result.put("success", true)
            result.put("status", "ONLINE")
            result.put("name", devName)
            result.put("address", macAddress)
            result.put("message", "Connected successfully to $devName.")
        } catch (e: Exception) {
            Log.e(TAG, "Bluetooth connection failed ($macAddress): ${e.message}")
            disconnect(macAddress)
            result.put("success", false)
            result.put("status", "OFFLINE")
            result.put("error", "Connection failed: ${e.localizedMessage ?: "Printer unreachable"}")
        }

        result
    }

    fun disconnect(macAddress: String) {
        try {
            activeStreams.remove(macAddress)?.close()
            activeSockets.remove(macAddress)?.close()
        } catch (e: IOException) {
            Log.w(TAG, "Error closing Bluetooth socket for $macAddress: ${e.message}")
        }
    }

    /**
     * Send raw ESC/POS binary data to printer with auto-reconnect
     */
    suspend fun printRaw(macAddress: String, data: ByteArray): JSONObject = withContext(Dispatchers.IO) {
        val result = JSONObject()
        var stream = activeStreams[macAddress]

        if (stream == null || activeSockets[macAddress]?.isConnected != true) {
            Log.i(TAG, "Socket dropped. Attempting auto-reconnect to $macAddress...")
            val connRes = connect(macAddress)
            if (!connRes.optBoolean("success", false)) {
                result.put("success", false)
                result.put("error", "Printer offline: ${connRes.optString("error")}")
                return@withContext result
            }
            stream = activeStreams[macAddress]
        }

        if (stream == null) {
            result.put("success", false)
            result.put("error", "OutputStream unavailable for $macAddress")
            return@withContext result
        }

        try {
            val chunkSize = 512
            var offset = 0
            while (offset < data.size) {
                val len = minOf(chunkSize, data.size - offset)
                stream.write(data, offset, len)
                offset += len
                delay(15)
            }
            stream.flush()

            result.put("success", true)
            result.put("bytesPrinted", data.size)
        } catch (e: Exception) {
            Log.e(TAG, "Write error during Bluetooth print to $macAddress: ${e.message}")
            disconnect(macAddress)
            result.put("success", false)
            result.put("error", "Transmission failed: ${e.localizedMessage}")
        }

        result
    }

    @SuppressLint("MissingPermission")
    fun getDiscoveredDevicesJson(): String {
        val array = JSONArray()
        discoveredDevices.values.forEach { device ->
            try {
                val name = device.name
                val address = device.address
                val isBonded = device.bondState == BluetoothDevice.BOND_BONDED
                val isConnected = activeSockets[address]?.isConnected == true

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

    private fun notifyDevicesUpdated() {
        val json = getDiscoveredDevicesJson()
        discoveryListener?.invoke(json)
    }

    fun cleanup() {
        try {
            context.unregisterReceiver(bluetoothReceiver)
        } catch (_: Exception) {}
        activeSockets.keys.toList().forEach { disconnect(it) }
    }

    companion object {
        private const val TAG = "BluetoothService"
    }
}
