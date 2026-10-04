package com.aurapos.pos.hardware

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.*
import android.os.Build
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/**
 * Native Android USB Host Thermal Printer Controller
 * Conforming to Section 8:
 * - Native Android UsbManager host APIs
 * - Real USB device discovery
 * - Permission management
 * - Interface claiming & bulk endpoint ESC/POS transmission
 * - Zero USB simulation
 */
class UsbPrinterManager(private val context: Context) {

    private val usbManager = context.getSystemService(Context.USB_SERVICE) as? UsbManager
    private val activeConnections = ConcurrentHashMap<String, UsbDeviceConnection>()
    private val activeEndpoints = ConcurrentHashMap<String, UsbEndpoint>()

    private val ACTION_USB_PERMISSION = "com.aurapos.pos.USB_PERMISSION"
    private var permissionCallback: ((Boolean, UsbDevice) -> Unit)? = null

    private val usbReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, intent: Intent) {
            when (intent.action) {
                ACTION_USB_PERMISSION -> {
                    synchronized(this) {
                        val device: UsbDevice? = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
                        val granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
                        if (device != null) {
                            permissionCallback?.invoke(granted, device)
                        }
                    }
                }
                UsbManager.ACTION_USB_DEVICE_DETACHED -> {
                    val device: UsbDevice? = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
                    if (device != null) {
                        disconnect(device.deviceName)
                    }
                }
            }
        }
    }

    init {
        val filter = IntentFilter().apply {
            addAction(ACTION_USB_PERMISSION)
            addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(usbReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            context.registerReceiver(usbReceiver, filter)
        }
    }

    /**
     * Scan for physical USB thermal receipt printers attached to this Android device.
     */
    fun scanUsbPrinters(): String {
        val array = JSONArray()
        val deviceList = usbManager?.deviceList ?: return array.toString()

        for ((name, device) in deviceList) {
            // Check if device is a printer (Interface Class 7) or has a bulk transfer OUT endpoint
            if (isPrinterDevice(device)) {
                val obj = JSONObject().apply {
                    put("id", device.deviceName)
                    put("name", getFriendlyName(device))
                    put("vendorId", device.vendorId)
                    put("productId", device.productId)
                    put("hasPermission", usbManager.hasPermission(device))
                    put("type", "usb")
                }
                array.put(obj)
            }
        }

        return array.toString()
    }

    private fun isPrinterDevice(device: UsbDevice): Boolean {
        for (i in 0 until device.interfaceCount) {
            val iface = device.getInterface(i)
            // Class 7 = Printer
            if (iface.interfaceClass == UsbConstants.USB_CLASS_PRINTER) {
                return true
            }
            // Check endpoints for bulk transfer OUT
            for (j in 0 until iface.endpointCount) {
                val endpoint = iface.getEndpoint(j)
                if (endpoint.type == UsbConstants.USB_ENDPOINT_XFER_BULK &&
                    endpoint.direction == UsbConstants.USB_DIR_OUT) {
                    return true
                }
            }
        }
        return false
    }

    private fun getFriendlyName(device: UsbDevice): String {
        val name = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            device.productName ?: device.manufacturerName
        } else null
        return name ?: "USB Thermal Printer (${device.vendorId}:${device.productId})"
    }

    private fun findUsbDevice(identifier: String): UsbDevice? {
        val list = usbManager?.deviceList ?: return null
        if (list.containsKey(identifier)) {
            return list[identifier]
        }
        for ((_, dev) in list) {
            if (dev.deviceName.equals(identifier, ignoreCase = true) ||
                identifier.contains("${dev.vendorId}") ||
                identifier.contains("${dev.productId}")) {
                return dev
            }
        }
        val printers = list.values.filter { isPrinterDevice(it) }
        return printers.firstOrNull()
    }

    /**
     * Connect and claim USB printer interface.
     */
    suspend fun connect(deviceName: String): JSONObject = withContext(Dispatchers.IO) {
        val result = JSONObject()
        val device = findUsbDevice(deviceName)

        if (device == null) {
            result.put("success", false)
            result.put("status", "OFFLINE")
            result.put("error", "USB printer device not found or disconnected.")
            return@withContext result
        }

        val actualName = device.deviceName

        if (usbManager?.hasPermission(device) != true) {
            requestPermission(device)
            result.put("success", false)
            result.put("status", "PERMISSION_REQUIRED")
            result.put("error", "USB Host permission required. Please grant access in the system dialog.")
            return@withContext result
        }

        try {
            // Find target printer interface and OUT endpoint
            var targetInterface: UsbInterface? = null
            var targetEndpoint: UsbEndpoint? = null

            for (i in 0 until device.interfaceCount) {
                val iface = device.getInterface(i)
                for (j in 0 until iface.endpointCount) {
                    val ep = iface.getEndpoint(j)
                    if (ep.type == UsbConstants.USB_ENDPOINT_XFER_BULK &&
                        ep.direction == UsbConstants.USB_DIR_OUT) {
                        targetInterface = iface
                        targetEndpoint = ep
                        break
                    }
                }
                if (targetEndpoint != null) break
            }

            if (targetInterface == null || targetEndpoint == null) {
                result.put("success", false)
                result.put("status", "ERROR")
                result.put("error", "Device does not expose bulk OUT print endpoint.")
                return@withContext result
            }

            val connection = usbManager.openDevice(device)
            if (connection == null) {
                result.put("success", false)
                result.put("status", "OFFLINE")
                result.put("error", "Failed to open USB device connection.")
                return@withContext result
            }

            val claimed = connection.claimInterface(targetInterface, true)
            if (!claimed) {
                connection.close()
                result.put("success", false)
                result.put("status", "ERROR")
                result.put("error", "Could not claim USB printer interface.")
                return@withContext result
            }

            activeConnections[deviceName] = connection
            activeEndpoints[deviceName] = targetEndpoint
            if (actualName != deviceName) {
                activeConnections[actualName] = connection
                activeEndpoints[actualName] = targetEndpoint
            }

            // Send ESC @ init
            val init = byteArrayOf(0x1B, 0x40)
            connection.bulkTransfer(targetEndpoint, init, init.size, 2000)

            result.put("success", true)
            result.put("status", "ONLINE")
            result.put("name", getFriendlyName(device))
            result.put("message", "USB thermal printer connected successfully.")
        } catch (e: Exception) {
            Log.e(TAG, "USB connect error: ${e.message}")
            disconnect(deviceName)
            result.put("success", false)
            result.put("status", "OFFLINE")
            result.put("error", "USB error: ${e.localizedMessage}")
        }

        result
    }

    private fun requestPermission(device: UsbDevice) {
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
        val intent = Intent(ACTION_USB_PERMISSION)
        val pendingIntent = PendingIntent.getBroadcast(context, 0, intent, flags)
        usbManager?.requestPermission(device, pendingIntent)
    }

    suspend fun printRaw(deviceName: String, data: ByteArray): JSONObject = withContext(Dispatchers.IO) {
        val result = JSONObject()
        val device = findUsbDevice(deviceName)
        val actualName = device?.deviceName ?: deviceName

        var connection = activeConnections[deviceName] ?: activeConnections[actualName]
        var endpoint = activeEndpoints[deviceName] ?: activeEndpoints[actualName]

        if (connection == null || endpoint == null) {
            val connRes = connect(deviceName)
            if (!connRes.optBoolean("success", false)) {
                result.put("success", false)
                result.put("error", "USB printer offline: ${connRes.optString("error")}")
                return@withContext result
            }
            connection = activeConnections[deviceName] ?: activeConnections[actualName]
            endpoint = activeEndpoints[deviceName] ?: activeEndpoints[actualName]
        }

        if (connection == null || endpoint == null) {
            result.put("success", false)
            result.put("error", "USB endpoint unavailable.")
            return@withContext result
        }

        try {
            val chunkSize = 1024
            var offset = 0
            while (offset < data.size) {
                val len = minOf(chunkSize, data.size - offset)
                val chunk = data.copyOfRange(offset, offset + len)
                val transferred = connection.bulkTransfer(endpoint, chunk, chunk.size, 5000)
                if (transferred < 0) {
                    throw Exception("USB bulk transfer returned error code: $transferred")
                }
                offset += len
            }

            result.put("success", true)
            result.put("bytesPrinted", data.size)
        } catch (e: Exception) {
            Log.e(TAG, "USB print error: ${e.message}")
            disconnect(deviceName)
            result.put("success", false)
            result.put("error", "USB transmission error: ${e.localizedMessage}")
        }

        result
    }

    fun disconnect(deviceName: String) {
        try {
            activeConnections.remove(deviceName)?.close()
            activeEndpoints.remove(deviceName)
        } catch (_: Exception) {}
    }

    fun cleanup() {
        try {
            context.unregisterReceiver(usbReceiver)
        } catch (_: Exception) {}
        activeConnections.keys.toList().forEach { disconnect(it) }
    }

    companion object {
        private const val TAG = "UsbPrinterManager"
    }
}
