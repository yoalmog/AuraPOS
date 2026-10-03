package com.aurapos.pos.bridge

import android.app.Activity
import android.content.Context
import android.os.Build
import android.util.Base64
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.aurapos.pos.data.LocalDatabaseHelper
import com.aurapos.pos.hardware.*
import kotlinx.coroutines.*
import org.json.JSONObject

/**
 * AuraPOS Centralized Native Android Hardware Bridge
 * Conforming to Section 4:
 * Exposes:
 * - printer.scanBluetooth()
 * - printer.connectBluetooth(deviceId)
 * - printer.disconnectBluetooth(deviceId)
 * - printer.print(printerId, data)
 * - printer.testPrint(printerId)
 * - printer.scanUSB()
 * - printer.connectUSB(deviceId)
 * - printer.disconnectUSB(deviceId)
 * - printer.connectNetwork(ip, port)
 * - printer.testNetwork(ip, port)
 * - barcode.startScanner()
 * - barcode.stopScanner()
 * - cashDrawer.open(printerId)
 * - getDiagnostics()
 */
class NativeBridge(
    private val activity: Activity,
    private val webView: WebView,
    private val bluetoothManager: BluetoothPrinterManager,
    private val networkManager: NetworkPrinterManager,
    private val usbManager: UsbPrinterManager,
    private val cashDrawerManager: CashDrawerManager,
    private val barcodeManager: BarcodeScannerManager,
    private val dbHelper: LocalDatabaseHelper
) {

    private val bridgeScope = CoroutineScope(Dispatchers.Main + Job())

    // -------------------------------------------------------------
    // Bluetooth Hardware APIs (Section 5)
    // -------------------------------------------------------------

    @JavascriptInterface
    fun scanBluetooth(): String {
        return bluetoothManager.startScan { devicesJson ->
            postEventToWebView("onBluetoothDevicesDiscovered", devicesJson)
        }
    }

    @JavascriptInterface
    fun stopBluetoothScan() {
        bluetoothManager.stopScan()
    }

    @JavascriptInterface
    fun getPairedBluetoothDevices(): String {
        return bluetoothManager.getDiscoveredDevicesJson()
    }

    @JavascriptInterface
    fun connectBluetooth(macAddress: String, callbackId: String) {
        bridgeScope.launch {
            val result = bluetoothManager.connect(macAddress)
            postCallback(callbackId, result.toString())
        }
    }

    @JavascriptInterface
    fun disconnectBluetooth(macAddress: String) {
        bluetoothManager.disconnect(macAddress)
    }

    @JavascriptInterface
    fun requestBluetoothPermissions() {
        (activity as? com.aurapos.pos.MainActivity)?.requestBluetoothPermissions()
    }

    @JavascriptInterface
    fun getBluetoothStatus(): String {
        return JSONObject().apply {
            put("enabled", bluetoothManager.isBluetoothEnabled())
            put("hasPermissions", bluetoothManager.hasPermissions())
        }.toString()
    }

    // -------------------------------------------------------------
    // USB Hardware APIs (Section 8)
    // -------------------------------------------------------------

    @JavascriptInterface
    fun scanUSB(): String {
        return usbManager.scanUsbPrinters()
    }

    @JavascriptInterface
    fun connectUSB(deviceName: String, callbackId: String) {
        bridgeScope.launch {
            val result = usbManager.connect(deviceName)
            postCallback(callbackId, result.toString())
        }
    }

    @JavascriptInterface
    fun disconnectUSB(deviceName: String) {
        usbManager.disconnect(deviceName)
    }

    // -------------------------------------------------------------
    // LAN / Wi-Fi Network APIs (Section 7)
    // -------------------------------------------------------------

    @JavascriptInterface
    fun testNetwork(ip: String, port: Int, callbackId: String) {
        bridgeScope.launch {
            val result = networkManager.testConnection(ip, port)
            postCallback(callbackId, result.toString())
        }
    }

    // -------------------------------------------------------------
    // Unified ESC/POS Raw Printing (Section 9 & 10)
    // -------------------------------------------------------------

    @JavascriptInterface
    fun print(connectionType: String, targetIdentifier: String, base64Data: String, port: Int, callbackId: String) {
        bridgeScope.launch {
            val rawBytes = try {
                Base64.decode(base64Data, Base64.DEFAULT)
            } catch (e: Exception) {
                val err = JSONObject().apply {
                    put("success", false)
                    put("error", "Base64 decode error: ${e.message}")
                }
                postCallback(callbackId, err.toString())
                return@launch
            }

            val result = when (connectionType.lowercase()) {
                "bluetooth", "x18" -> bluetoothManager.printRaw(targetIdentifier, rawBytes)
                "lan", "network", "escpos" -> networkManager.printRaw(targetIdentifier, port, rawBytes)
                "usb" -> usbManager.printRaw(targetIdentifier, rawBytes)
                else -> JSONObject().apply {
                    put("success", false)
                    put("error", "Unsupported native printer connection type: $connectionType")
                }
            }

            postCallback(callbackId, result.toString())
        }
    }

    // -------------------------------------------------------------
    // Cash Drawer API (Section 20)
    // -------------------------------------------------------------

    @JavascriptInterface
    fun openCashDrawer(printerType: String, targetIdentifier: String, port: Int, callbackId: String) {
        bridgeScope.launch {
            val result = cashDrawerManager.open(printerType, targetIdentifier, port)
            postCallback(callbackId, result.toString())
        }
    }

    // -------------------------------------------------------------
    // Barcode Scanner APIs (Section 19)
    // -------------------------------------------------------------

    @JavascriptInterface
    fun startBarcodeScanner() {
        barcodeManager.startListening { barcode ->
            postEventToWebView("onBarcodeScanned", JSONObject().apply {
                put("barcode", barcode)
            }.toString())
        }
    }

    @JavascriptInterface
    fun stopBarcodeScanner() {
        barcodeManager.stopListening()
    }

    // -------------------------------------------------------------
    // Hardware Diagnostics (Section 32)
    // -------------------------------------------------------------

    @JavascriptInterface
    fun getDiagnostics(): String {
        return JSONObject().apply {
            put("isNativeAndroid", true)
            put("androidVersion", Build.VERSION.RELEASE)
            put("sdkInt", Build.VERSION.SDK_INT)
            put("deviceModel", "${Build.MANUFACTURER} ${Build.MODEL}")
            put("bluetoothAvailable", bluetoothManager.isBluetoothEnabled())
            put("networkAvailable", networkManager.isNetworkAvailable())
            put("appVersion", "1.0.0-PROD")
        }.toString()
    }

    // -------------------------------------------------------------
    // Helper Dispatchers to JavaScript
    // -------------------------------------------------------------

    private fun postCallback(callbackId: String, jsonResult: String) {
        activity.runOnUiThread {
            val js = "window.__AuraPOSNativeCallbacks && window.__AuraPOSNativeCallbacks['$callbackId'] && window.__AuraPOSNativeCallbacks['$callbackId']($jsonResult);"
            webView.evaluateJavascript(js, null)
        }
    }

    private fun postEventToWebView(eventName: String, jsonPayload: String) {
        activity.runOnUiThread {
            val js = "window.__AuraPOSEventBus && window.__AuraPOSEventBus.emit('$eventName', $jsonPayload);"
            webView.evaluateJavascript(js, null)
        }
    }

    fun cleanup() {
        bridgeScope.cancel()
    }

    companion object {
        const val JS_INTERFACE_NAME = "AndroidPOSNative"
    }
}
