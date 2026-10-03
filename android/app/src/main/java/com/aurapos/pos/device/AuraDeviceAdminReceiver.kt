package com.aurapos.pos.device

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import android.widget.Toast

/**
 * AuraPOS Android Enterprise Device Admin Receiver
 * Provides:
 * - Device Owner / Managed Device callback handling
 * - Dedicated POS Kiosk Lock Task Mode configuration
 * - Device wipe / suspend enforcement
 */
class AuraDeviceAdminReceiver : DeviceAdminReceiver() {

    override fun onEnabled(context: Context, intent: Intent) {
        super.onEnabled(context, intent)
        Log.i(TAG, "AuraPOS Device Administration enabled.")
        Toast.makeText(context, "AuraPOS Device Administration Enabled", Toast.LENGTH_SHORT).show()
    }

    override fun onDisabled(context: Context, intent: Intent) {
        super.onDisabled(context, intent)
        Log.w(TAG, "AuraPOS Device Administration disabled.")
    }

    override fun onLockTaskModeEntering(context: Context, intent: Intent, pkg: String) {
        super.onLockTaskModeEntering(context, intent, pkg)
        Log.i(TAG, "Entering dedicated POS Kiosk Lock Task mode for package: $pkg")
    }

    override fun onLockTaskModeExiting(context: Context, intent: Intent) {
        super.onLockTaskModeExiting(context, intent)
        Log.w(TAG, "Exiting POS Kiosk Lock Task mode.")
    }

    companion object {
        private const val TAG = "AuraDeviceAdmin"
    }
}
