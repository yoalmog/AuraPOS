package com.aurapos.pos

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.*
import android.widget.Toast
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import android.util.Base64
import android.util.Log
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.lifecycleScope
import androidx.webkit.WebViewAssetLoader
import com.aurapos.pos.bridge.NativeBridge
import com.aurapos.pos.data.LocalDatabaseHelper
import com.aurapos.pos.device.DeviceManager
import com.aurapos.pos.hardware.*
import com.aurapos.pos.ocr.ImagePreprocessor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * AuraPOS Native Android Terminal Activity
 * Provides:
 * - Immersive full-screen dedicated POS UI
 * - Hardware barcode gun / wedge scanner interception
 * - Native hardware bridge initialization
 * - Bluetooth, USB, and LAN printer permissions
 * - Camera & File Chooser support for AI Menu Scanner
 * - Master DeviceManager lifecycle integration
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var nativeBridge: NativeBridge
    private lateinit var bluetoothManager: BluetoothPrinterManager
    private lateinit var networkManager: NetworkPrinterManager
    private lateinit var usbManager: UsbPrinterManager
    private lateinit var builtInPrinterManager: BuiltInPrinterManager
    private lateinit var cashDrawerManager: CashDrawerManager
    private lateinit var barcodeManager: BarcodeScannerManager
    private lateinit var dbHelper: LocalDatabaseHelper
    lateinit var deviceManager: DeviceManager
        private set

    // File Chooser state for HTML5 <input type="file"> support
    private var fileUploadCallback: ValueCallback<Array<Uri>>? = null

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val intent = result.data
            val uris: Array<Uri>? = when {
                intent?.clipData != null -> {
                    val count = intent.clipData!!.itemCount
                    Array(count) { i -> intent.clipData!!.getItemAt(i).uri }
                }
                intent?.data != null -> arrayOf(intent.data!!)
                else -> null
            }
            fileUploadCallback?.onReceiveValue(uris)
        } else {
            fileUploadCallback?.onReceiveValue(null)
        }
        fileUploadCallback = null
    }

    // Camera WebRTC Permission state
    private var pendingPermissionRequest: PermissionRequest? = null

    private val requestCameraPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        if (isGranted) {
            pendingPermissionRequest?.grant(pendingPermissionRequest?.resources)
        } else {
            pendingPermissionRequest?.deny()
            Toast.makeText(this, "Camera permission is required to scan menus.", Toast.LENGTH_SHORT).show()
        }
        pendingPermissionRequest = null
    }

    // Permission launcher for Android 12+ Bluetooth & Camera
    private val requestBluetoothPermissionsLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val scanGranted = permissions[Manifest.permission.BLUETOOTH_SCAN] ?: false
        val connectGranted = permissions[Manifest.permission.BLUETOOTH_CONNECT] ?: false

        if (scanGranted && connectGranted) {
            Toast.makeText(this, "Bluetooth printer permissions granted.", Toast.LENGTH_SHORT).show()
        }
    }

    // -------------------------------------------------------------
    // Native Menu Scanner Image Acquisition (Requirement 2)
    // -------------------------------------------------------------
    private var pendingNativeCameraCallbackId: String? = null
    private var pendingNativeGalleryCallbackId: String? = null

    private val nativeCameraLauncher = registerForActivityResult(
        ActivityResultContracts.TakePicturePreview()
    ) { bitmap ->
        val cbId = pendingNativeCameraCallbackId
        pendingNativeCameraCallbackId = null
        if (cbId != null) {
            if (bitmap != null) {
                val dataUrl = ImagePreprocessor.toBase64DataUrl(bitmap, 85)
                val pageObj = JSONObject().apply {
                    put("id", "page_cam_${System.currentTimeMillis()}")
                    put("name", "Camera Capture ${System.currentTimeMillis() % 1000}")
                    put("dataUrl", dataUrl)
                    put("mimeType", "image/jpeg")
                    put("rotation", 0)
                    put("timestamp", java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.US).format(java.util.Date()))
                    put("fileSize", dataUrl.length * 3 / 4)
                }
                val res = JSONObject().apply {
                    put("success", true)
                    put("pages", JSONArray().apply { put(pageObj) })
                }
                postBridgeCallback(cbId, res.toString())
            } else {
                postBridgeCallback(cbId, JSONObject().apply {
                    put("success", false)
                    put("cancelled", true)
                }.toString())
            }
        }
    }

    private val nativeGalleryLauncher = registerForActivityResult(
        ActivityResultContracts.GetMultipleContents()
    ) { uris ->
        val cbId = pendingNativeGalleryCallbackId
        pendingNativeGalleryCallbackId = null
        if (cbId != null) {
            if (!uris.isNullOrEmpty()) {
                val pagesArray = JSONArray()
                uris.forEachIndexed { idx, uri ->
                    try {
                        contentResolver.openInputStream(uri)?.use { stream ->
                            val bitmap = BitmapFactory.decodeStream(stream)
                            if (bitmap != null) {
                                val dataUrl = ImagePreprocessor.toBase64DataUrl(bitmap, 85)
                                pagesArray.put(JSONObject().apply {
                                    put("id", "page_gal_${System.currentTimeMillis()}_$idx")
                                    put("name", "Gallery Page ${idx + 1}")
                                    put("dataUrl", dataUrl)
                                    put("mimeType", "image/jpeg")
                                    put("rotation", 0)
                                    put("timestamp", java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.US).format(java.util.Date()))
                                    put("fileSize", dataUrl.length * 3 / 4)
                                })
                            }
                        }
                    } catch (e: Exception) {
                        Log.e("MainActivity", "Error loading gallery uri: $uri", e)
                    }
                }
                postBridgeCallback(cbId, JSONObject().apply {
                    put("success", true)
                    put("pages", pagesArray)
                }.toString())
            } else {
                postBridgeCallback(cbId, JSONObject().apply {
                    put("success", false)
                    put("cancelled", true)
                }.toString())
            }
        }
    }

    fun launchNativeCamera(callbackId: String) {
        runOnUiThread {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                pendingNativeCameraCallbackId = callbackId
                try {
                    nativeCameraLauncher.launch(null)
                } catch (e: Exception) {
                    Log.e("MainActivity", "Failed to launch native camera", e)
                    postBridgeCallback(callbackId, JSONObject().apply {
                        put("success", false)
                        put("error", e.message ?: "Failed to open camera")
                    }.toString())
                }
            } else {
                requestCameraPermissionLauncher.launch(Manifest.permission.CAMERA)
                postBridgeCallback(callbackId, JSONObject().apply {
                    put("success", false)
                    put("error", "Camera permission requested")
                }.toString())
            }
        }
    }

    fun launchNativeGallery(allowMultiple: Boolean, callbackId: String) {
        runOnUiThread {
            pendingNativeGalleryCallbackId = callbackId
            try {
                nativeGalleryLauncher.launch("image/*")
            } catch (e: Exception) {
                Log.e("MainActivity", "Failed to launch gallery", e)
                postBridgeCallback(callbackId, JSONObject().apply {
                    put("success", false)
                    put("error", e.message ?: "Failed to open gallery")
                }.toString())
            }
        }
    }

    fun importPdfMenu(base64Pdf: String, callbackId: String) {
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val cleanBase64 = base64Pdf.substringAfter("base64,")
                val pdfBytes = Base64.decode(cleanBase64, Base64.DEFAULT)
                val tempFile = File.createTempFile("menu_import_", ".pdf", cacheDir)
                tempFile.writeBytes(pdfBytes)

                val fileDescriptor = ParcelFileDescriptor.open(tempFile, ParcelFileDescriptor.MODE_READ_ONLY)
                val pdfRenderer = PdfRenderer(fileDescriptor)
                val pageCount = pdfRenderer.pageCount
                val pagesArray = JSONArray()

                for (pageIdx in 0 until pageCount) {
                    val page = pdfRenderer.openPage(pageIdx)
                    val targetW = page.width * 2
                    val targetH = page.height * 2
                    val bitmap = Bitmap.createBitmap(targetW, targetH, Bitmap.Config.ARGB_8888)
                    val canvas = Canvas(bitmap)
                    canvas.drawColor(Color.WHITE)
                    page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT)
                    page.close()

                    val dataUrl = ImagePreprocessor.toBase64DataUrl(bitmap, 85)
                    pagesArray.put(JSONObject().apply {
                        put("id", "page_pdf_${System.currentTimeMillis()}_${pageIdx + 1}")
                        put("name", "PDF Page ${pageIdx + 1}")
                        put("dataUrl", dataUrl)
                        put("mimeType", "image/jpeg")
                        put("rotation", 0)
                        put("timestamp", java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.US).format(java.util.Date()))
                        put("fileSize", dataUrl.length * 3 / 4)
                    })
                }

                pdfRenderer.close()
                fileDescriptor.close()
                tempFile.delete()

                postBridgeCallback(callbackId, JSONObject().apply {
                    put("success", true)
                    put("pages", pagesArray)
                }.toString())
            } catch (e: Exception) {
                Log.e("MainActivity", "PDF import failed: ${e.message}", e)
                postBridgeCallback(callbackId, JSONObject().apply {
                    put("success", false)
                    put("error", e.message ?: "Failed to render PDF menu")
                }.toString())
            }
        }
    }

    private fun postBridgeCallback(callbackId: String, jsonResult: String) {
        runOnUiThread {
            try {
                val encoded = Base64.encodeToString(jsonResult.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
                val js = "try { if (window.__AuraPOSNativeCallbacks && window.__AuraPOSNativeCallbacks['$callbackId']) { window.__AuraPOSNativeCallbacks['$callbackId'](JSON.parse(atob('$encoded'))); } } catch(e) { console.error('Bridge callback delivery error:', e); }"
                webView.evaluateJavascript(js, null)
            } catch (e: Exception) {
                Log.e("MainActivity", "Error dispatching callback $callbackId: ${e.message}")
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 1. Configure dedicated immersive fullscreen POS terminal mode
        setupImmersiveMode()

        // 2. Initialize hardware managers & persistent database
        dbHelper = (application as POSApplication).databaseHelper
        bluetoothManager = BluetoothPrinterManager(this)
        networkManager = NetworkPrinterManager(this)
        usbManager = UsbPrinterManager(this)
        builtInPrinterManager = BuiltInPrinterManager(this)
        cashDrawerManager = CashDrawerManager(bluetoothManager, networkManager, usbManager)
        barcodeManager = BarcodeScannerManager(this)

        // 3. Request required Bluetooth permissions on startup
        checkAndRequestPermissions()

        // 4. Configure asset loader to serve local assets securely via HTTPS (resolves ES module CORS blocks)
        val assetLoader = WebViewAssetLoader.Builder()
            .setDomain("appassets.androidplatform.net")
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        // 5. Configure native WebView
        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.allowFileAccess = true
            settings.allowContentAccess = true
            settings.allowFileAccessFromFileURLs = true
            settings.allowUniversalAccessFromFileURLs = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true

            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                    android.util.Log.d("AuraPOS-Web", "${message.message()} -- From line ${message.lineNumber()} of ${message.sourceId()}")
                    return true
                }

                // Handle HTML5 <input type="file"> file picking for menu images & PDFs
                override fun onShowFileChooser(
                    webView: WebView?,
                    filePathCallback: ValueCallback<Array<Uri>>?,
                    fileChooserParams: FileChooserParams?
                ): Boolean {
                    fileUploadCallback?.onReceiveValue(null)
                    fileUploadCallback = filePathCallback

                    val intent = fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                        type = "*/*"
                        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                        addCategory(Intent.CATEGORY_OPENABLE)
                    }

                    return try {
                        fileChooserLauncher.launch(intent)
                        true
                    } catch (e: Exception) {
                        android.util.Log.e("AuraPOS-Web", "File chooser launch failed", e)
                        fileUploadCallback?.onReceiveValue(null)
                        fileUploadCallback = null
                        false
                    }
                }

                // Handle HTML5 navigator.mediaDevices.getUserMedia camera permission
                override fun onPermissionRequest(request: PermissionRequest?) {
                    request?.let {
                        val resources = it.resources
                        val hasCamera = resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
                        if (hasCamera) {
                            if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                                it.grant(resources)
                            } else {
                                pendingPermissionRequest = it
                                requestCameraPermissionLauncher.launch(Manifest.permission.CAMERA)
                            }
                        } else {
                            it.grant(resources)
                        }
                    }
                }
            }

            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest
                ): WebResourceResponse? {
                    return assetLoader.shouldInterceptRequest(request.url)
                }

                override fun onReceivedError(
                    view: WebView?,
                    request: WebResourceRequest?,
                    error: WebResourceError?
                ) {
                    super.onReceivedError(view, request, error)
                    android.util.Log.e("AuraPOS-Web", "Web resource error: ${error?.description} on ${request?.url}")
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    // Notify web layer that native Android host environment is ready
                    evaluateJavascript("window.dispatchEvent(new CustomEvent('AndroidPOSNativeReady'));", null)
                }
            }
        }

        // 6. Attach centralized NativeBridge
        nativeBridge = NativeBridge(
            this,
            webView,
            bluetoothManager,
            networkManager,
            usbManager,
            builtInPrinterManager,
            cashDrawerManager,
            barcodeManager,
            dbHelper
        )
        webView.addJavascriptInterface(nativeBridge, NativeBridge.JS_INTERFACE_NAME)

        setContentView(webView)

        // 7. Load POS Application securely via WebViewAssetLoader
        webView.loadUrl("https://appassets.androidplatform.net/assets/index.html")
    }

    private fun setupImmersiveMode() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.hide(WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            setupImmersiveMode()
        }
    }

    fun requestBluetoothPermissions() {
        runOnUiThread {
            checkAndRequestPermissions()
        }
    }

    private fun checkAndRequestPermissions() {
        val permissionsToRequest = mutableListOf<String>()

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            permissionsToRequest.add(Manifest.permission.CAMERA)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
                permissionsToRequest.add(Manifest.permission.BLUETOOTH_SCAN)
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                permissionsToRequest.add(Manifest.permission.BLUETOOTH_CONNECT)
            }
        } else {
            // Android 8 - 11 legacy Bluetooth
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                permissionsToRequest.add(Manifest.permission.ACCESS_FINE_LOCATION)
            }
        }

        if (permissionsToRequest.isNotEmpty()) {
            requestBluetoothPermissionsLauncher.launch(permissionsToRequest.toTypedArray())
        }
    }

    /**
     * Intercepts physical key events from external USB or Bluetooth barcode scanner guns.
     */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (barcodeManager.onKeyEvent(event)) {
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    override fun onDestroy() {
        super.onDestroy()
        nativeBridge.cleanup()
        bluetoothManager.cleanup()
        usbManager.cleanup()
        barcodeManager.stopListening()
    }
}
