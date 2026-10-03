package com.aurapos.pos.device

import android.app.Activity
import android.content.Context
import android.util.Log
import com.aurapos.pos.data.LocalDatabaseHelper
import com.aurapos.pos.hardware.BarcodeScannerManager
import com.aurapos.pos.hardware.BluetoothPrinterManager
import com.aurapos.pos.hardware.CashDrawerManager
import com.aurapos.pos.hardware.NetworkPrinterManager
import com.aurapos.pos.hardware.UsbPrinterManager
import org.json.JSONObject

/**
 * AuraPOS Master Android Device Manager
 * Conforming to Section 1 Architecture:
 * The single authoritative orchestrator coordinating:
 * - DeviceIdentityManager
 * - KioskManager
 * - SecurityManager
 * - DeviceHealthManager
 * - RecoveryManager
 * - AuditManager
 * - DiagnosticsManager
 */
class DeviceManager(
    val activity: Activity,
    val dbHelper: LocalDatabaseHelper,
    val bluetoothManager: BluetoothPrinterManager,
    val networkManager: NetworkPrinterManager,
    val usbManager: UsbPrinterManager,
    val cashDrawerManager: CashDrawerManager,
    val barcodeManager: BarcodeScannerManager
) {
    val identityManager = DeviceIdentityManager(activity)
    val kioskManager = KioskManager(activity)
    val securityManager = SecurityManager(activity)
    val healthManager = DeviceHealthManager(activity, bluetoothManager, networkManager)
    val recoveryManager = RecoveryManager(activity, dbHelper)
    val auditManager = AuditManager(activity, dbHelper)
    val diagnosticsManager = DiagnosticsManager(
        activity,
        identityManager,
        kioskManager,
        healthManager,
        bluetoothManager,
        networkManager,
        usbManager
    )

    init {
        Log.i(TAG, "Initializing master AuraPOS DeviceManager subsystem...")
        // Run startup recovery check
        recoveryManager.performStartupCheck()
        // Record startup audit event
        auditManager.logEvent(
            userId = "SYSTEM",
            userRole = "SYSTEM",
            terminalId = identityManager.getTerminalId(),
            action = "DEVICE_BOOT",
            entity = "TERMINAL",
            details = "Terminal booted and initialized successfully.",
            result = "SUCCESS"
        )
    }

    companion object {
        private const val TAG = "AuraDeviceManager"
    }
}
