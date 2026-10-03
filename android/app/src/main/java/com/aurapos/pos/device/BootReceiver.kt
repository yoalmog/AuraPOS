package com.aurapos.pos.device

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import com.aurapos.pos.MainActivity

/**
 * AuraPOS Boot & Startup Receiver
 * Automatically launches AuraPOS terminal interface after Android device reboot
 * when permitted by device management / kiosk policies.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED ||
            intent.action == "android.intent.action.QUICKBOOT_POWERON"
        ) {
            Log.i(TAG, "Android device boot detected. Validating AuraPOS terminal auto-start policy...")

            val prefs = context.getSharedPreferences("aurapos_device_config", Context.MODE_PRIVATE)
            val autoStart = prefs.getBoolean("auto_start_on_boot", true)
            val isActivated = prefs.getString("activation_state", "UNREGISTERED") == "ACTIVE"

            if (autoStart && isActivated) {
                Log.i(TAG, "Launching AuraPOS POS Terminal in kiosk mode...")
                val launchIntent = Intent(context, MainActivity::class.java).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                    putExtra("EXTRA_BOOT_LAUNCH", true)
                }
                context.startActivity(launchIntent)
            } else {
                Log.i(TAG, "Skipping boot launch: autoStart=$autoStart, isActivated=$isActivated")
            }
        }
    }

    companion object {
        private const val TAG = "AuraBootReceiver"
    }
}
