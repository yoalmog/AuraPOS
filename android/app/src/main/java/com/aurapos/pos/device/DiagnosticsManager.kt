package com.aurapos.pos.device

import android.content.Context
import android.os.Build
import com.aurapos.pos.hardware.BluetoothPrinterManager
import com.aurapos.pos.hardware.NetworkPrinterManager
import com.aurapos.pos.hardware.UsbPrinterManager
import org.json.JSONObject

/**
 * AuraPOS Diagnostics Manager
 * Conforming to Section 30:
 * Aggregates all technical diagnostics without exposing secrets
 */
class DiagnosticsManager(
    private val context: Context,
    private val identityManager: DeviceIdentityManager,
    private val kioskManager: KioskManager,
    private val healthManager: DeviceHealthManager,
    private val bluetoothManager: BluetoothPrinterManager?,
    private val networkManager: NetworkPrinterManager?,
    private val usbManager: UsbPrinterManager?
) {

    fun generateFullDiagnostics(): JSONObject {
        val health = healthManager.computeHealth()
        val identity = identityManager.toJsonObject()
        val kiosk = kioskManager.getStatusJson()

        return JSONObject().apply {
            put("application", JSONObject().apply {
                put("name", "AuraPOS")
                put("versionName", "1.0.0")
                put("versionCode", 1)
                put("packageId", context.packageName)
                put("environment", "PRODUCTION_ANDROID")
            })

            put("device", JSONObject().apply {
                put("manufacturer", Build.MANUFACTURER)
                put("model", Build.MODEL)
                put("brand", Build.BRAND)
                put("device", Build.DEVICE)
                put("androidVersion", Build.VERSION.RELEASE)
                put("sdkInt", Build.VERSION.SDK_INT)
                put("storeId", identity.optString("storeId"))
                put("terminalId", identity.optString("terminalId"))
                put("installationId", identity.optString("installationId"))
                put("activationState", identity.optString("activationState"))
            })

            put("kiosk", kiosk)
            put("health", health)

            put("hardware", JSONObject().apply {
                put("bluetoothEnabled", bluetoothManager?.isBluetoothEnabled() ?: false)
                put("bluetoothPermissionsGranted", bluetoothManager?.hasPermissions() ?: false)
                put("networkConnected", networkManager?.isNetworkAvailable() ?: false)
            })

            put("timestamp", System.currentTimeMillis())
        }
    }
}
