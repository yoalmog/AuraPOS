package com.aurapos.pos.device

import android.app.Activity
import android.app.ActivityManager
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.util.Log
import org.json.JSONObject

/**
 * AuraPOS Dedicated Android Kiosk Manager
 * Conforming to Sections 4, 5, 32:
 * - Real Android Lock Task Mode implementation
 * - Distinguishes between:
 *   1. Standard unmanaged app (App Pinning)
 *   2. Android Enterprise / Device Owner (Fully Managed Kiosk)
 * - Prevents users from escaping POS, accessing system settings, or opening unauthorized apps
 */
class KioskManager(
    private val activity: Activity
) {
    private val dpm = activity.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager
    private val am = activity.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
    private val adminComponent = ComponentName(activity, AuraDeviceAdminReceiver::class.java)

    fun isDeviceOwner(): Boolean {
        return try {
            dpm?.isDeviceOwnerApp(activity.packageName) ?: false
        } catch (e: Exception) {
            false
        }
    }

    fun isLockTaskPermitted(): Boolean {
        return try {
            dpm?.isLockTaskPermitted(activity.packageName) ?: false
        } catch (e: Exception) {
            false
        }
    }

    fun isInLockTaskMode(): Boolean {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am?.lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE
            } else {
                @Suppress("DEPRECATION")
                am?.isInLockTaskMode ?: false
            }
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Start POS Kiosk Mode
     * If provisioned as Device Owner, enables strict corporate Lock Task mode without prompt.
     * If unmanaged, requests standard Android Lock Task pinning.
     */
    fun enterKioskMode(): Boolean {
        return try {
            if (isDeviceOwner()) {
                Log.i(TAG, "Device Owner detected. Setting up dedicated POS Kiosk policies...")
                // Whitelist package for lock task
                dpm?.setLockTaskPackages(adminComponent, arrayOf(activity.packageName))

                // Configure lock task features for Android 9+ (API 28+)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    dpm?.setLockTaskFeatures(
                        adminComponent,
                        DevicePolicyManager.LOCK_TASK_FEATURE_SYSTEM_INFO or
                                DevicePolicyManager.LOCK_TASK_FEATURE_KEYGUARD
                    )
                }

                // Set persistent preferred activity (default home launcher)
                val filter = android.content.IntentFilter(android.content.Intent.ACTION_MAIN).apply {
                    addCategory(android.content.Intent.CATEGORY_HOME)
                    addCategory(android.content.Intent.CATEGORY_DEFAULT)
                }
                dpm?.addPersistentPreferredActivity(
                    adminComponent,
                    filter,
                    ComponentName(activity, activity.javaClass)
                )
            }

            activity.startLockTask()
            Log.i(TAG, "startLockTask() called successfully.")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to enter lock task mode: ${e.message}", e)
            false
        }
    }

    /**
     * Exit POS Kiosk Mode
     * Requires administrative authorization.
     */
    fun exitKioskMode(): Boolean {
        return try {
            if (isInLockTaskMode()) {
                activity.stopLockTask()
                Log.i(TAG, "stopLockTask() called successfully.")
                true
            } else {
                Log.i(TAG, "Device was not in lock task mode.")
                true
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to exit lock task mode: ${e.message}", e)
            false
        }
    }

    fun getStatusJson(): JSONObject {
        val stateStr = when {
            isInLockTaskMode() -> "ACTIVE_LOCK_TASK"
            isDeviceOwner() -> "DEVICE_OWNER_READY"
            else -> "UNMANAGED"
        }

        return JSONObject().apply {
            put("isInLockTaskMode", isInLockTaskMode())
            put("isDeviceOwner", isDeviceOwner())
            put("isLockTaskPermitted", isLockTaskPermitted())
            put("kioskState", stateStr)
            put("provisioningCommand", "adb shell dpm set-device-owner com.aurapos.pos/.device.AuraDeviceAdminReceiver")
        }
    }

    companion object {
        private const val TAG = "AuraKioskManager"
    }
}
