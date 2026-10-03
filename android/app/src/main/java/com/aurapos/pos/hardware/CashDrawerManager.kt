package com.aurapos.pos.hardware

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Native Android Cash Drawer Controller
 * Conforming to Section 20:
 * - Uses ESC/POS drawer kick pulse: ESC p m t1 t2 (0x1B, 0x70, 0x00, 0x19, 0xFA)
 * - Zero simulation of cash drawer opening
 * - Dispatches pulse via target printer interface (Bluetooth, LAN, or USB)
 */
class CashDrawerManager(
    private val bluetoothManager: BluetoothPrinterManager,
    private val networkManager: NetworkPrinterManager,
    private val usbManager: UsbPrinterManager
) {

    // ESC/POS Cash Drawer Kick Command: ESC p m t1 t2
    // Pin 2 pulse: 0x1B, 0x70, 0x00, 0x19, 0xFA (25 * 2ms on, 250 * 2ms off)
    private val DRAWER_KICK_BYTES = byteArrayOf(0x1B, 0x70, 0x00, 0x19.toByte(), 0xFA.toByte())

    suspend fun open(
        printerType: String,
        targetIdentifier: String,
        port: Int = 9100
    ): JSONObject = withContext(Dispatchers.IO) {
        val result = JSONObject()
        Log.i(TAG, "Sending ESC/POS cash drawer pulse to $printerType ($targetIdentifier)...")

        try {
            when (printerType.lowercase()) {
                "bluetooth", "x18" -> {
                    val printRes = bluetoothManager.printRaw(targetIdentifier, DRAWER_KICK_BYTES)
                    result.put("success", printRes.optBoolean("success", false))
                    result.put("error", printRes.optString("error", null))
                }
                "lan", "network", "escpos" -> {
                    val printRes = networkManager.printRaw(targetIdentifier, port, DRAWER_KICK_BYTES)
                    result.put("success", printRes.optBoolean("success", false))
                    result.put("error", printRes.optString("error", null))
                }
                "usb" -> {
                    val printRes = usbManager.printRaw(targetIdentifier, DRAWER_KICK_BYTES)
                    result.put("success", printRes.optBoolean("success", false))
                    result.put("error", printRes.optString("error", null))
                }
                else -> {
                    result.put("success", false)
                    result.put("error", "Unknown printer connection type: $printerType")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to send cash drawer pulse: ${e.message}")
            result.put("success", false)
            result.put("error", e.localizedMessage)
        }

        result
    }

    companion object {
        private const val TAG = "CashDrawerManager"
    }
}
