package com.aurapos.pos

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.*
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import com.aurapos.pos.bridge.NativeBridge
import com.aurapos.pos.data.LocalDatabaseHelper
import com.aurapos.pos.device.DeviceManager
import com.aurapos.pos.hardware.*

/**
 * AuraPOS Native Android Terminal Activity
 * Provides:
 * - Immersive full-screen dedicated POS UI
 * - Hardware barcode gun / wedge scanner interception
 * - Native hardware bridge initialization
 * - Bluetooth, USB, and LAN printer permissions
 * - Master DeviceManager lifecycle integration
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var nativeBridge: NativeBridge
    private lateinit var bluetoothManager: BluetoothPrinterManager
    private lateinit var networkManager: NetworkPrinterManager
    private lateinit var usbManager: UsbPrinterManager
    private lateinit var cashDrawerManager: CashDrawerManager
    private lateinit var barcodeManager: BarcodeScannerManager
    private lateinit var dbHelper: LocalDatabaseHelper
    lateinit var deviceManager: DeviceManager
        private set

    // Permission launcher for Android 12+ Bluetooth
    private val requestBluetoothPermissionsLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val scanGranted = permissions[Manifest.permission.BLUETOOTH_SCAN] ?: false
        val connectGranted = permissions[Manifest.permission.BLUETOOTH_CONNECT] ?: false

        if (scanGranted && connectGranted) {
            Toast.makeText(this, "Bluetooth printer permissions granted.", Toast.LENGTH_SHORT).show()
        } else {
            Toast.makeText(
                this,
                "Bluetooth permission denied. Bluetooth thermal printers (X18 Mini) cannot be paired without permission.",
                Toast.LENGTH_LONG
            ).show()
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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val permissionsToRequest = mutableListOf<String>()
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
                permissionsToRequest.add(Manifest.permission.BLUETOOTH_SCAN)
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                permissionsToRequest.add(Manifest.permission.BLUETOOTH_CONNECT)
            }
            if (permissionsToRequest.isNotEmpty()) {
                requestBluetoothPermissionsLauncher.launch(permissionsToRequest.toTypedArray())
            }
        } else {
            // Android 8 - 11 legacy Bluetooth
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                requestBluetoothPermissionsLauncher.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION))
            }
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
