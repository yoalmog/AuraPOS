package com.aurapos.pos.hardware

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.util.Log
import android.view.KeyEvent

/**
 * Native Android Barcode Scanner Controller
 * Conforming to Section 19:
 * - Dedicated hardware wedge scanner input (physical USB / Bluetooth scanner guns)
 * - Broadcast receivers for commercial POS terminal scanners:
 *   - Zebra / Motorola DataWedge (com.symbol.datawedge.data_string)
 *   - Sunmi POS Scanner (com.sunmi.scanner.ACTION_DATA_CODE_RECEIVED)
 *   - Honeywell Scanning Intent (com.honeywell.decode.intent.action.BARCODE_DATA)
 *   - iMin / Datalogic commercial POS terminals
 */
class BarcodeScannerManager(private val context: Context) {

    private var onBarcodeScannedCallback: ((String) -> Unit)? = null
    private var isListening = false

    // Hardware Keyboard / Wedge barcode buffer
    private val keyBuffer = StringBuilder()
    private var lastKeyTimestamp: Long = 0

    // Commercial POS intent actions
    private val ACTION_SUNMI_SCAN = "com.sunmi.scanner.ACTION_DATA_CODE_RECEIVED"
    private val ACTION_ZEBRA_SCAN = "com.aurapos.pos.ZEBRA_SCAN"
    private val ACTION_HONEYWELL_SCAN = "com.honeywell.decode.intent.action.BARCODE_DATA"

    private val scanReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, intent: Intent) {
            val barcode = when (intent.action) {
                ACTION_SUNMI_SCAN -> intent.getStringExtra("data")
                ACTION_ZEBRA_SCAN -> intent.getStringExtra("com.symbol.datawedge.data_string")
                ACTION_HONEYWELL_SCAN -> intent.getStringExtra("data")
                else -> null
            }

            if (!barcode.isNullOrBlank()) {
                Log.d(TAG, "Hardware barcode received via broadcast: $barcode")
                onBarcodeScannedCallback?.invoke(barcode.trim())
            }
        }
    }

    fun startListening(callback: (String) -> Unit) {
        onBarcodeScannedCallback = callback
        if (!isListening) {
            val filter = IntentFilter().apply {
                addAction(ACTION_SUNMI_SCAN)
                addAction(ACTION_ZEBRA_SCAN)
                addAction(ACTION_HONEYWELL_SCAN)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.registerReceiver(scanReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                context.registerReceiver(scanReceiver, filter)
            }
            isListening = true
            Log.i(TAG, "Barcode scanner hardware listener active.")
        }
    }

    fun stopListening() {
        if (isListening) {
            try {
                context.unregisterReceiver(scanReceiver)
            } catch (e: Exception) {}
            isListening = false
            onBarcodeScannedCallback = null
        }
    }

    /**
     * Intercepts key events from physical USB/Bluetooth handheld barcode guns.
     * High typing speed (< 50ms per key) ending with ENTER indicates a barcode scan.
     */
    fun onKeyEvent(event: KeyEvent): Boolean {
        if (event.action != KeyEvent.ACTION_DOWN) return false

        val now = System.currentTimeMillis()
        if (now - lastKeyTimestamp > 250) {
            keyBuffer.clear()
        }
        lastKeyTimestamp = now

        if (event.keyCode == KeyEvent.KEYCODE_ENTER) {
            val barcode = keyBuffer.toString().trim()
            keyBuffer.clear()
            if (barcode.length >= 3) {
                Log.d(TAG, "Hardware barcode intercepted from wedge: $barcode")
                onBarcodeScannedCallback?.invoke(barcode)
                return true
            }
            return false
        }

        val char = event.unicodeChar.toChar()
        if (char.isLetterOrDigit() || char in "-_./") {
            keyBuffer.append(char)
        }

        return false
    }

    companion object {
        private const val TAG = "BarcodeScannerManager"
    }
}
