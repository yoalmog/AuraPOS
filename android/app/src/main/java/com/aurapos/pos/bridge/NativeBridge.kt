package com.aurapos.pos.bridge

import android.app.Activity
import android.content.Context
import android.graphics.BitmapFactory
import android.os.Build
import android.util.Base64
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import com.aurapos.pos.data.LocalDatabaseHelper
import com.aurapos.pos.hardware.*
import com.aurapos.pos.ocr.*
import kotlinx.coroutines.*
import org.json.JSONArray
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
    // AI Menu Scanner API Native Forwarder & Health Diagnostics
    // -------------------------------------------------------------

    @JavascriptInterface
    fun analyzeMenu(payloadJson: String, callbackId: String) {
        bridgeScope.launch(Dispatchers.IO) {
            try {
                val parsed = try { JSONObject(payloadJson) } catch (e: Exception) { null }
                val customEndpoint = parsed?.optString("endpointUrl", null)
                val requestId = parsed?.optString("requestId", "scan_${System.currentTimeMillis()}")
                val targetUrl = if (!customEndpoint.isNullOrBlank()) {
                    customEndpoint
                } else {
                    "https://api.aurapos.com/api/menu/analyze"
                }

                val url = java.net.URL(targetUrl)
                val conn = url.openConnection() as java.net.HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("Accept", "application/json")
                conn.setRequestProperty("X-Request-ID", requestId)
                // Forward backend credentials supplied by the web layer (allowlisted headers only)
                val authHeaders = parsed?.optJSONObject("authHeaders")
                if (authHeaders != null) {
                    for (name in listOf("Authorization", "X-Aura-Api-Key")) {
                        val value = authHeaders.optString(name, "")
                        if (value.isNotBlank()) conn.setRequestProperty(name, value)
                    }
                }
                conn.instanceFollowRedirects = false // Do not silently follow redirects to authentication/cookie HTML gates
                conn.doOutput = true
                conn.connectTimeout = 30000
                conn.readTimeout = 120000

                // Never send credentials in the request body
                val bodyJson = if (parsed != null) { parsed.remove("authHeaders"); parsed.toString() } else payloadJson
                conn.outputStream.use { os ->
                    os.write(bodyJson.toByteArray(Charsets.UTF_8))
                    os.flush()
                }

                val responseCode = conn.responseCode
                if (responseCode == 301 || responseCode == 302) {
                    val loc = conn.getHeaderField("Location") ?: ""
                    val errObj = JSONObject().apply {
                        put("success", false)
                        put("status", responseCode)
                        put("error", "The backend endpoint returned redirect ($responseCode) to '$loc'. It appears to be an authenticated proxy or invalid address.")
                        put("errorType", "BACKEND_UNREACHABLE")
                        put("requestId", requestId)
                    }
                    postCallback(callbackId, errObj.toString())
                    return@launch
                }

                val stream = if (responseCode in 200..299) conn.inputStream else conn.errorStream
                val responseStr = stream?.bufferedReader()?.use { it.readText() } ?: "{}"

                postCallback(callbackId, responseStr)
            } catch (e: java.net.UnknownHostException) {
                val errObj = JSONObject().apply {
                    put("success", false)
                    put("status", 0)
                    put("error", "DNS resolution failed. The backend server hostname could not be resolved.")
                    put("errorType", "DNS_ERROR")
                }
                postCallback(callbackId, errObj.toString())
            } catch (e: javax.net.ssl.SSLException) {
                val errObj = JSONObject().apply {
                    put("success", false)
                    put("status", 0)
                    put("error", "TLS/SSL security handshake failed: ${e.message}")
                    put("errorType", "TLS_ERROR")
                }
                postCallback(callbackId, errObj.toString())
            } catch (e: java.net.SocketTimeoutException) {
                val errObj = JSONObject().apply {
                    put("success", false)
                    put("status", 0)
                    put("error", "Connection to AI backend timed out after 120 seconds. Scanned pages are preserved locally.")
                    put("errorType", "BACKEND_TIMEOUT")
                }
                postCallback(callbackId, errObj.toString())
            } catch (e: Exception) {
                Log.e("NativeBridge", "analyzeMenu native failed: ${e.message}", e)
                val errObj = JSONObject().apply {
                    put("success", false)
                    put("status", 0)
                    put("error", "Could not establish connection to the AuraPOS AI backend: ${e.message}")
                    put("errorType", "BACKEND_UNREACHABLE")
                }
                postCallback(callbackId, errObj.toString())
            }
        }
    }

    // -------------------------------------------------------------
    // Native Local-First On-Device Menu Scanner (Requirements 1-9, 15)
    // -------------------------------------------------------------

    private val localOcrService: LocalOcrService by lazy {
        MlKitLocalOcrService()
    }

    @JavascriptInterface
    fun launchNativeCamera(callbackId: String) {
        (activity as? com.aurapos.pos.MainActivity)?.launchNativeCamera(callbackId)
    }

    @JavascriptInterface
    fun launchNativeGallery(allowMultiple: Boolean, callbackId: String) {
        (activity as? com.aurapos.pos.MainActivity)?.launchNativeGallery(allowMultiple, callbackId)
    }

    @JavascriptInterface
    fun importPdfMenu(base64Pdf: String, callbackId: String) {
        (activity as? com.aurapos.pos.MainActivity)?.importPdfMenu(base64Pdf, callbackId)
    }

    @JavascriptInterface
    fun preprocessImageLocal(base64Image: String, rotationDegrees: Int, callbackId: String) {
        bridgeScope.launch(Dispatchers.Default) {
            try {
                val cleanBase64 = base64Image.substringAfter("base64,")
                val bytes = Base64.decode(cleanBase64, Base64.DEFAULT)
                val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                    ?: throw IllegalArgumentException("Could not decode image bitmap")

                val preprocessed = ImagePreprocessor.preprocessForOcr(bitmap, rotationDegrees)
                val originalDataUrl = ImagePreprocessor.toBase64DataUrl(preprocessed.originalBitmap, 85)
                val ocrDataUrl = ImagePreprocessor.toBase64DataUrl(preprocessed.processedOcrBitmap, 85)

                val res = JSONObject().apply {
                    put("success", true)
                    put("originalDataUrl", originalDataUrl)
                    put("processedOcrDataUrl", ocrDataUrl)
                    put("width", preprocessed.width)
                    put("height", preprocessed.height)
                }
                postCallback(callbackId, res.toString())
            } catch (e: Exception) {
                Log.e("NativeBridge", "preprocessImageLocal error: ${e.message}", e)
                postCallback(callbackId, JSONObject().apply {
                    put("success", false)
                    put("error", e.message ?: "Failed to preprocess image")
                }.toString())
            }
        }
    }

    @JavascriptInterface
    fun recognizeMenuLocal(base64Image: String, pageNumber: Int, callbackId: String) {
        bridgeScope.launch(Dispatchers.Default) {
            val startTime = System.currentTimeMillis()
            try {
                val cleanBase64 = base64Image.substringAfter("base64,")
                val bytes = Base64.decode(cleanBase64, Base64.DEFAULT)
                val rawBitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                    ?: throw IllegalArgumentException("Failed to decode image into Bitmap")

                // Step 1: Local Image Preprocessing with OpenCV (rotation, deskew, perspective correction)
                val preprocessed = ImagePreprocessor.preprocessForOcr(rawBitmap)
                val correctedDataUrl = ImagePreprocessor.toBase64DataUrl(preprocessed.correctedBitmap, 85)
                val processedOcrDataUrl = ImagePreprocessor.toBase64DataUrl(preprocessed.processedOcrBitmap, 80)

                // Step 2: On-Device OCR with Google ML Kit configured for Spanish Script
                val ocrResult = localOcrService.recognize(preprocessed.processedOcrBitmap, pageNumber)

                // Step 3: Query existing product names for duplicate detection
                val existingNames = dbHelper.getAllProductNames()

                // Step 4: Spatial Menu Structure & Price Detection Parser
                val parsedStructure = MenuStructureParser.parseOcrResult(ocrResult, pageNumber, existingNames)

                val totalDuration = System.currentTimeMillis() - startTime

                val responseJson = JSONObject().apply {
                    put("success", true)
                    put("source", "native_android_local_ocr")
                    put("durationMs", totalDuration)
                    put("detectedCurrency", parsedStructure.detectedCurrency)
                    put("menuTitle", parsedStructure.menuTitle ?: "Menu Page $pageNumber")
                    put("correctedDataUrl", correctedDataUrl)
                    put("processedOcrDataUrl", processedOcrDataUrl)
                    put("detectedRotation", preprocessed.rotationDegrees)
                    put("deskewAngle", preprocessed.deskewAngle)
                    put("perspectiveCorrected", preprocessed.perspectiveCorrected)
                    put("categories", JSONArray().apply {
                        parsedStructure.categories.forEach { put(it.toJsonObject()) }
                    })
                    put("products", JSONArray().apply {
                        parsedStructure.products.forEach { put(it.toJsonObject()) }
                    })
                    put("ocrResult", ocrResult.toJsonObject())
                }

                postCallback(callbackId, responseJson.toString())
            } catch (e: Exception) {
                Log.e("NativeBridge", "recognizeMenuLocal failed: ${e.message}", e)
                val errObj = JSONObject().apply {
                    put("success", false)
                    put("error", e.message ?: "Local on-device OCR recognition failed")
                    put("durationMs", System.currentTimeMillis() - startTime)
                }
                postCallback(callbackId, errObj.toString())
            }
        }
    }

    @JavascriptInterface
    fun batchImportToDatabase(payloadJson: String, callbackId: String) {
        bridgeScope.launch(Dispatchers.IO) {
            try {
                val obj = JSONObject(payloadJson)
                val categories = obj.optJSONArray("categories") ?: JSONArray()
                val products = obj.optJSONArray("products") ?: JSONArray()
                val storeId = obj.optString("storeId", "store_aura_main")

                val result = dbHelper.batchImportMenu(categories, products, storeId)
                postCallback(callbackId, result.toString())
            } catch (e: Exception) {
                Log.e("NativeBridge", "batchImportToDatabase failed: ${e.message}", e)
                postCallback(callbackId, JSONObject().apply {
                    put("success", false)
                    put("error", e.message ?: "Failed to import menu into local database")
                }.toString())
            }
        }
    }

    @JavascriptInterface
    fun checkBackendHealth(targetUrl: String, callbackId: String) {
        bridgeScope.launch(Dispatchers.IO) {
            val startTime = System.currentTimeMillis()
            try {
                val cleanUrl = if (targetUrl.endsWith("/api/health") || targetUrl.endsWith("/health")) {
                    targetUrl
                } else {
                    "${targetUrl.trimEnd('/')}/api/health"
                }

                val url = java.net.URL(cleanUrl)
                val conn = url.openConnection() as java.net.HttpURLConnection
                conn.requestMethod = "GET"
                conn.setRequestProperty("Accept", "application/json")
                conn.connectTimeout = 10000
                conn.readTimeout = 10000
                conn.instanceFollowRedirects = false // Detect redirect barriers

                val code = conn.responseCode
                val latency = System.currentTimeMillis() - startTime

                if (code in 200..299) {
                    val body = conn.inputStream.bufferedReader().use { it.readText() }
                    val json = try { JSONObject(body) } catch(e: Exception) { JSONObject() }
                    val res = JSONObject().apply {
                        put("success", true)
                        put("status", code)
                        put("latencyMs", latency)
                        put("dnsOk", true)
                        put("tlsOk", cleanUrl.startsWith("https"))
                        put("aiServiceAvailable", json.optBoolean("aiServiceAvailable", true))
                        put("service", json.optString("service", "AuraPOS AI Backend"))
                        put("timestamp", java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.US).apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }.format(java.util.Date()))
                    }
                    postCallback(callbackId, res.toString())
                } else if (code == 301 || code == 302) {
                    val loc = conn.getHeaderField("Location") ?: ""
                    val res = JSONObject().apply {
                        put("success", false)
                        put("status", code)
                        put("latencyMs", latency)
                        put("dnsOk", true)
                        put("tlsOk", cleanUrl.startsWith("https"))
                        put("error", "Endpoint returned redirect ($code) to '$loc'. An authentication gateway or development proxy is blocking direct access.")
                        put("errorType", "BACKEND_UNREACHABLE")
                    }
                    postCallback(callbackId, res.toString())
                } else {
                    val res = JSONObject().apply {
                        put("success", false)
                        put("status", code)
                        put("latencyMs", latency)
                        put("dnsOk", true)
                        put("tlsOk", cleanUrl.startsWith("https"))
                        put("error", "Server responded with HTTP $code")
                        put("errorType", "HTTP_$code")
                    }
                    postCallback(callbackId, res.toString())
                }
            } catch (e: java.net.UnknownHostException) {
                postCallback(callbackId, JSONObject().apply {
                    put("success", false)
                    put("status", 0)
                    put("dnsOk", false)
                    put("error", "DNS resolution failed. Hostname could not be found.")
                    put("errorType", "DNS_ERROR")
                }.toString())
            } catch (e: javax.net.ssl.SSLException) {
                postCallback(callbackId, JSONObject().apply {
                    put("success", false)
                    put("status", 0)
                    put("tlsOk", false)
                    put("error", "TLS/SSL certificate handshake failed: ${e.message}")
                    put("errorType", "TLS_ERROR")
                }.toString())
            } catch (e: java.net.SocketTimeoutException) {
                postCallback(callbackId, JSONObject().apply {
                    put("success", false)
                    put("status", 0)
                    put("error", "Connection timed out after 10s.")
                    put("errorType", "BACKEND_TIMEOUT")
                }.toString())
            } catch (e: Exception) {
                postCallback(callbackId, JSONObject().apply {
                    put("success", false)
                    put("status", 0)
                    put("error", e.message ?: "Failed to connect to backend")
                    put("errorType", "BACKEND_UNREACHABLE")
                }.toString())
            }
        }
    }

    // -------------------------------------------------------------
    // Accessibility & Haptics APIs (Section 11 & 20)
    // -------------------------------------------------------------

    @JavascriptInterface
    fun vibrate(durationMs: Long) {
        activity.runOnUiThread {
            try {
                val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    val manager = activity.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? android.os.VibratorManager
                    manager?.defaultVibrator
                } else {
                    @Suppress("DEPRECATION")
                    activity.getSystemService(Context.VIBRATOR_SERVICE) as? android.os.Vibrator
                }

                if (vibrator?.hasVibrator() == true) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        vibrator.vibrate(android.os.VibrationEffect.createOneShot(durationMs.coerceIn(10, 1000), android.os.VibrationEffect.DEFAULT_AMPLITUDE))
                    } else {
                        @Suppress("DEPRECATION")
                        vibrator.vibrate(durationMs.coerceIn(10, 1000))
                    }
                }
            } catch (e: Exception) {
                Log.w("NativeBridge", "Haptic vibration failed: ${e.message}")
            }
        }
    }

    @JavascriptInterface
    fun announceForAccessibility(text: String) {
        activity.runOnUiThread {
            try {
                webView.announceForAccessibility(text)
            } catch (e: Exception) {
                Log.w("NativeBridge", "Accessibility announcement failed: ${e.message}")
            }
        }
    }

    // -------------------------------------------------------------
    // Phase 3: Android Local Room Database & Sync Engine APIs
    // -------------------------------------------------------------

    private val localRepo = com.aurapos.pos.data.LocalRepository(activity)
    private val syncEngine = com.aurapos.pos.sync.SyncEngine.getInstance(activity)
    private val identityManager = com.aurapos.pos.device.DeviceIdentityManager(activity)

    @JavascriptInterface
    fun localDbGetTerminalIdentity(): String {
        return JSONObject().apply {
            put("storeId", identityManager.getStoreId())
            put("terminalId", identityManager.getTerminalId())
            put("deviceInstallationId", identityManager.getDeviceInstallationId())
            put("state", identityManager.getActivationState().name)
        }.toString()
    }

    @JavascriptInterface
    fun localDbGetProducts(query: String, callbackId: String) {
        bridgeScope.launch {
            try {
                val list = localRepo.getProducts(if (query.isBlank()) null else query)
                val jsonArr = JSONArray()
                for (p in list) {
                    jsonArr.put(JSONObject().apply {
                        put("id", p.id)
                        put("storeId", p.storeId)
                        put("categoryId", p.categoryId)
                        put("taxId", p.taxId)
                        put("name", p.name)
                        put("sku", p.sku ?: "")
                        put("barcode", p.barcode ?: "")
                        put("description", p.description ?: "")
                        put("price", p.price)
                        put("cost", p.cost)
                        put("unit", p.unit)
                        put("trackInventory", p.trackInventory)
                        put("stock", p.stockMinimum)
                        put("lowStockThreshold", p.stockMinimum)
                        put("isFavorite", p.isFavorite)
                        put("active", p.isActive)
                        put("imageUrl", p.imageUrl)
                        put("syncStatus", p.syncStatus)
                        put("createdAt", p.createdAt)
                        put("updatedAt", p.updatedAt)
                    })
                }
                postCallback(callbackId, JSONObject().apply {
                    put("success", true)
                    put("products", jsonArr)
                }.toString())
            } catch (e: Exception) {
                postCallback(callbackId, JSONObject().apply {
                    put("success", false)
                    put("error", e.message)
                }.toString())
            }
        }
    }

    @JavascriptInterface
    fun localDbGetProductByBarcode(barcode: String, callbackId: String) {
        bridgeScope.launch {
            try {
                val p = localRepo.getProductByBarcode(barcode)
                if (p != null) {
                    val pObj = JSONObject().apply {
                        put("id", p.id)
                        put("storeId", p.storeId)
                        put("categoryId", p.categoryId)
                        put("name", p.name)
                        put("sku", p.sku ?: "")
                        put("barcode", p.barcode ?: "")
                        put("price", p.price)
                        put("cost", p.cost)
                        put("unit", p.unit)
                        put("trackInventory", p.trackInventory)
                        put("stock", p.stockMinimum)
                        put("active", p.isActive)
                    }
                    postCallback(callbackId, JSONObject().apply {
                        put("success", true)
                        put("product", pObj)
                    }.toString())
                } else {
                    postCallback(callbackId, JSONObject().apply {
                        put("success", false)
                        put("product", JSONObject.NULL)
                    }.toString())
                }
            } catch (e: Exception) {
                postCallback(callbackId, JSONObject().apply {
                    put("success", false)
                    put("error", e.message)
                }.toString())
            }
        }
    }

    @JavascriptInterface
    fun localDbGetCategories(callbackId: String) {
        bridgeScope.launch {
            try {
                val list = localRepo.getCategories()
                val jsonArr = JSONArray()
                for (c in list) {
                    jsonArr.put(JSONObject().apply {
                        put("id", c.id)
                        put("storeId", c.storeId)
                        put("name", c.name)
                        put("icon", c.icon)
                        put("imageUrl", c.imageUrl)
                        put("color", c.color)
                        put("sortOrder", c.sortOrder)
                        put("printerId", c.printerId)
                        put("autoPrintKitchen", c.autoPrintKitchen)
                        put("active", c.isActive)
                        put("syncStatus", c.syncStatus)
                    })
                }
                postCallback(callbackId, JSONObject().apply {
                    put("success", true)
                    put("categories", jsonArr)
                }.toString())
            } catch (e: Exception) {
                postCallback(callbackId, JSONObject().apply {
                    put("success", false)
                    put("error", e.message)
                }.toString())
            }
        }
    }

    @JavascriptInterface
    fun localDbGetCustomers(query: String, callbackId: String) {
        bridgeScope.launch {
            try {
                val list = localRepo.getCustomers(if (query.isBlank()) null else query)
                val jsonArr = JSONArray()
                for (c in list) {
                    jsonArr.put(JSONObject().apply {
                        put("id", c.id)
                        put("storeId", c.storeId)
                        put("name", c.name)
                        put("phone", c.phone ?: "")
                        put("email", c.email ?: "")
                        put("address", c.address ?: "")
                        put("notes", c.notes ?: "")
                        put("loyaltyPoints", c.loyaltyPoints)
                        put("totalSpent", c.totalSpent)
                        put("totalOrders", c.totalOrders)
                        put("active", c.isActive)
                        put("syncStatus", c.syncStatus)
                    })
                }
                postCallback(callbackId, JSONObject().apply {
                    put("success", true)
                    put("customers", jsonArr)
                }.toString())
            } catch (e: Exception) {
                postCallback(callbackId, JSONObject().apply {
                    put("success", false)
                    put("error", e.message)
                }.toString())
            }
        }
    }

    @JavascriptInterface
    fun localDbSaveCustomer(customerJsonStr: String, callbackId: String) {
        bridgeScope.launch {
            try {
                val cObj = JSONObject(customerJsonStr)
                val c = localRepo.saveCustomer(cObj)
                postCallback(callbackId, JSONObject().apply {
                    put("success", true)
                    put("customerId", c.id)
                }.toString())
            } catch (e: Exception) {
                postCallback(callbackId, JSONObject().apply {
                    put("success", false)
                    put("error", e.message)
                }.toString())
            }
        }
    }

    @JavascriptInterface
    fun localDbRecordSale(saleJsonStr: String, callbackId: String) {
        bridgeScope.launch {
            try {
                val sObj = JSONObject(saleJsonStr)
                val result = localRepo.recordSaleAtomic(sObj)
                postCallback(callbackId, result.toString())
            } catch (e: Exception) {
                Log.e("NativeBridge", "Error executing atomic local sale: ${e.message}", e)
                postCallback(callbackId, JSONObject().apply {
                    put("success", false)
                    put("error", e.message ?: "Failed to record sale in local database")
                }.toString())
            }
        }
    }

    @JavascriptInterface
    fun localDbGetSales(limit: Int, offset: Int, callbackId: String) {
        bridgeScope.launch {
            try {
                val list = localRepo.getSales(limit.coerceIn(1, 200), offset.coerceAtLeast(0))
                val jsonArr = JSONArray()
                for (s in list) {
                    jsonArr.put(JSONObject().apply {
                        put("id", s.id)
                        put("storeId", s.storeId)
                        put("receiptNumber", s.receiptNumber)
                        put("customerId", s.customerId)
                        put("cashierId", s.cashierId)
                        put("orderType", s.orderType)
                        put("status", s.status)
                        put("subtotal", s.subtotal)
                        put("discountTotal", s.discountTotal)
                        put("taxTotal", s.taxTotal)
                        put("total", s.total)
                        put("currency", s.currency)
                        put("isOffline", s.isOffline)
                        put("syncStatus", s.syncStatus)
                        put("createdAt", s.createdAt)
                    })
                }
                postCallback(callbackId, JSONObject().apply {
                    put("success", true)
                    put("sales", jsonArr)
                }.toString())
            } catch (e: Exception) {
                postCallback(callbackId, JSONObject().apply {
                    put("success", false)
                    put("error", e.message)
                }.toString())
            }
        }
    }

    @JavascriptInterface
    fun localDbGetPendingSyncCount(callbackId: String) {
        bridgeScope.launch {
            try {
                val count = localRepo.getPendingSyncCount()
                postCallback(callbackId, JSONObject().apply {
                    put("success", true)
                    put("pendingCount", count)
                }.toString())
            } catch (e: Exception) {
                postCallback(callbackId, JSONObject().apply {
                    put("success", false)
                    put("pendingCount", 0)
                }.toString())
            }
        }
    }

    @JavascriptInterface
    fun localDbGetSyncStatus(callbackId: String) {
        bridgeScope.launch {
            try {
                val status = syncEngine.getStatus()
                val pending = localRepo.getPendingSyncCount()
                status.put("pendingUploads", pending)
                postCallback(callbackId, status.toString())
            } catch (e: Exception) {
                postCallback(callbackId, JSONObject().apply {
                    put("status", "ERROR")
                    put("error", e.message)
                }.toString())
            }
        }
    }

    @JavascriptInterface
    fun localDbTriggerSync(callbackId: String) {
        bridgeScope.launch {
            try {
                val result = syncEngine.syncNow()
                postCallback(callbackId, result.toString())
            } catch (e: Exception) {
                postCallback(callbackId, JSONObject().apply {
                    put("success", false)
                    put("error", e.message)
                }.toString())
            }
        }
    }

    @JavascriptInterface
    fun localDbRetrySync(callbackId: String) {
        bridgeScope.launch {
            try {
                val result = syncEngine.retryFailed()
                postCallback(callbackId, result.toString())
            } catch (e: Exception) {
                postCallback(callbackId, JSONObject().apply {
                    put("success", false)
                    put("error", e.message)
                }.toString())
            }
        }
    }

    @JavascriptInterface
    fun localDbGetSyncEvents(status: String, limit: Int, callbackId: String) {
        bridgeScope.launch {
            try {
                val list = localRepo.getSyncEvents(status, limit.coerceIn(1, 100))
                val jsonArr = JSONArray()
                for (ev in list) {
                    jsonArr.put(JSONObject().apply {
                        put("id", ev.id)
                        put("clientEventId", ev.clientEventId)
                        put("entityType", ev.entityType)
                        put("entityId", ev.entityId)
                        put("operation", ev.operation)
                        put("status", ev.status)
                        put("attempts", ev.attempts)
                        put("errorMessage", ev.errorMessage)
                        put("createdAt", ev.createdAt)
                    })
                }
                postCallback(callbackId, JSONObject().apply {
                    put("success", true)
                    put("events", jsonArr)
                }.toString())
            } catch (e: Exception) {
                postCallback(callbackId, JSONObject().apply {
                    put("success", false)
                    put("error", e.message)
                }.toString())
            }
        }
    }

    @JavascriptInterface
    fun localDbGetLocalReports(dateFrom: String, dateTo: String, callbackId: String) {
        bridgeScope.launch {
            try {
                val report = localRepo.getLocalReports(dateFrom, dateTo)
                postCallback(callbackId, report.toString())
            } catch (e: Exception) {
                postCallback(callbackId, JSONObject().apply {
                    put("success", false)
                    put("error", e.message)
                }.toString())
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
