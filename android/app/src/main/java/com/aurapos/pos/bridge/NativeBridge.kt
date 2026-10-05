package com.aurapos.pos.bridge

import android.app.Activity
import android.content.Context
import android.os.Build
import android.util.Base64
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
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
 * - printer.getBuiltInPrinter()
 * - printer.printViaSystemSpooler(title, content)
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
    private val builtInPrinterManager: BuiltInPrinterManager,
    private val cashDrawerManager: CashDrawerManager,
    private val barcodeManager: BarcodeScannerManager,
    private val dbHelper: LocalDatabaseHelper
) {

    private val bridgeScope = CoroutineScope(Dispatchers.Main + Job())

    private var activeSpoolWebView: WebView? = null

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
    // Integrated / Built-in Terminal Hardware APIs (Sunmi & POS Terminals)
    // -------------------------------------------------------------

    @JavascriptInterface
    fun getBuiltInPrinter(): String {
        val info = builtInPrinterManager.getBuiltInPrinterInfo()
        return (info ?: JSONObject().apply {
            put("hasBuiltIn", false)
        }).toString()
    }

    // -------------------------------------------------------------
    // Android System Print Spooler (android.print.PrintManager)
    // -------------------------------------------------------------

    @JavascriptInterface
    fun printViaSystemSpooler(title: String, receiptText: String, callbackId: String) {
        activity.runOnUiThread {
            try {
                val printManager = activity.getSystemService(Context.PRINT_SERVICE) as? android.print.PrintManager
                if (printManager == null) {
                    val err = JSONObject().apply {
                        put("success", false)
                        put("error", "Android PrintManager service is unavailable on this device.")
                    }
                    postCallback(callbackId, err.toString())
                    return@runOnUiThread
                }

                val spoolWebView = WebView(activity)
                activeSpoolWebView = spoolWebView
                spoolWebView.webViewClient = object : WebViewClient() {
                    override fun onPageFinished(view: WebView?, url: String?) {
                        val printAdapter = spoolWebView.createPrintDocumentAdapter(title)
                        val printJob = printManager.print(
                            title,
                            printAdapter,
                            android.print.PrintAttributes.Builder()
                                .setMediaSize(android.print.PrintAttributes.MediaSize.ISO_A4)
                                .build()
                        )
                        val res = JSONObject().apply {
                            put("success", printJob != null)
                            if (printJob == null) put("error", "Failed to initialize Android system print spooler.")
                        }
                        postCallback(callbackId, res.toString())
                    }
                }

                val safeText = receiptText
                    .replace("&", "&amp;")
                    .replace("<", "&lt;")
                    .replace(">", "&gt;")

                val html = """
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="utf-8">
                        <title>$title</title>
                        <style>
                            @page { margin: 4mm; }
                            body {
                                font-family: monospace;
                                font-size: 11pt;
                                line-height: 1.35;
                                white-space: pre-wrap;
                                margin: 0;
                                padding: 8px;
                                color: #000;
                            }
                        </style>
                    </head>
                    <body>$safeText</body>
                    </html>
                """.trimIndent()

                spoolWebView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null)
            } catch (e: Exception) {
                val err = JSONObject().apply {
                    put("success", false)
                    put("error", "System print spooler error: ${e.localizedMessage}")
                }
                postCallback(callbackId, err.toString())
            }
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

            val connLower = connectionType.lowercase()
            val result = when (connLower) {
                "builtin", "sunmi", "internal" -> builtInPrinterManager.printRaw(rawBytes)
                "bluetooth", "x18", "cat", "x6", "x6h", "x6h_ble", "raster", "ble" -> bluetoothManager.printRaw(targetIdentifier, rawBytes, connLower)
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

    @JavascriptInterface
    fun testX6hHardware(targetIdentifier: String, callbackId: String) {
        bridgeScope.launch {
            val testBitmap = bluetoothManager.createX6hTestPrintBitmap()
            val result = bluetoothManager.printX6hBitmap(targetIdentifier, testBitmap)
            postCallback(callbackId, result.toString())
        }
    }

    @JavascriptInterface
    fun testBleWrite(targetIdentifier: String, callbackId: String) {
        bridgeScope.launch {
            val result = bluetoothManager.testBleWrite(targetIdentifier)
            postCallback(callbackId, result.toString())
        }
    }

    @JavascriptInterface
    fun getGattDiagnostic(targetIdentifier: String, callbackId: String) {
        bridgeScope.launch {
            val result = bluetoothManager.getGattDiagnosticJson(targetIdentifier)
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
            put("hasBuiltInPrinter", builtInPrinterManager.hasBuiltInPrinter())
            put("appVersion", "1.0.0-PROD")
        }.toString()
    }

    // -------------------------------------------------------------
    // AI Menu Scanner API Native Forwarder
    // -------------------------------------------------------------

    @JavascriptInterface
    fun analyzeMenu(payloadJson: String, callbackId: String) {
        bridgeScope.launch(Dispatchers.IO) {
            try {
                val url = java.net.URL("https://ais-dev-67yayhjbdr2qcybjx7s4jj-113121063300.us-west2.run.app/api/menu/analyze")
                val conn = url.openConnection() as java.net.HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.doOutput = true
                conn.connectTimeout = 30000
                conn.readTimeout = 60000

                conn.outputStream.use { os ->
                    os.write(payloadJson.toByteArray(Charsets.UTF_8))
                    os.flush()
                }

                val responseCode = conn.responseCode
                val stream = if (responseCode in 200..299) conn.inputStream else conn.errorStream
                val responseStr = stream.bufferedReader().use { it.readText() }

                postCallback(callbackId, responseStr)
            } catch (e: Exception) {
                Log.e("NativeBridge", "analyzeMenu native failed: ${e.message}", e)
                val errObj = JSONObject().apply {
                    put("success", false)
                    put("error", e.message ?: "Native OCR bridge request failed")
                }
                postCallback(callbackId, errObj.toString())
            }
        }
    }

    // -------------------------------------------------------------
    // Safe Helper Dispatchers to JavaScript
    // -------------------------------------------------------------

    private fun postCallback(callbackId: String, jsonResult: String) {
        activity.runOnUiThread {
            try {
                // Safely base64 encode payload to avoid escaping/quote syntax errors in evaluateJavascript
                val encoded = Base64.encodeToString(jsonResult.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
                val js = "try { if (window.__AuraPOSNativeCallbacks && window.__AuraPOSNativeCallbacks['$callbackId']) { window.__AuraPOSNativeCallbacks['$callbackId'](JSON.parse(atob('$encoded'))); } } catch(e) { console.error('Bridge callback delivery error:', e); }"
                webView.evaluateJavascript(js, null)
            } catch (e: Exception) {
                Log.e("NativeBridge", "Error dispatching callback $callbackId: ${e.message}")
            }
        }
    }

    private fun postEventToWebView(eventName: String, jsonPayload: String) {
        activity.runOnUiThread {
            try {
                val encoded = Base64.encodeToString(jsonPayload.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
                val js = "try { if (window.__AuraPOSEventBus) { window.__AuraPOSEventBus.emit('$eventName', atob('$encoded')); } } catch(e) { console.error('Event bus delivery error:', e); }"
                webView.evaluateJavascript(js, null)
            } catch (e: Exception) {
                Log.e("NativeBridge", "Error dispatching event $eventName: ${e.message}")
            }
        }
    }

    fun cleanup() {
        bridgeScope.cancel()
        builtInPrinterManager.cleanup()
    }

    companion object {
        const val JS_INTERFACE_NAME = "AndroidPOSNative"
    }
}
