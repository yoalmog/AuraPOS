package com.aurapos.pos.device

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONObject
import java.util.UUID

/**
 * AuraPOS Device Identity & Lifecycle Manager
 * Conforming to Sections 2, 3, 26, 27:
 * - Persistent application-level identity: store_id, terminal_id, device_installation_id
 * - Terminal states: UNREGISTERED, PENDING_ACTIVATION, ACTIVE, SUSPENDED, DECOMMISSIONED
 * - Hardware identifier independence (never uses IMEI as primary app identity)
 * - Encrypted storage for sensitive credentials via Android Keystore
 */
class DeviceIdentityManager(private val context: Context) {

    private val prefs: SharedPreferences = createSecurePreferences()

    enum class ActivationState {
        UNREGISTERED,
        PENDING_ACTIVATION,
        ACTIVE,
        SUSPENDED,
        DECOMMISSIONED
    }

    init {
        // Ensure device installation ID is established once and stays permanently
        if (!prefs.contains(KEY_INSTALLATION_ID)) {
            val generatedId = "inst_" + UUID.randomUUID().toString()
            prefs.edit().putString(KEY_INSTALLATION_ID, generatedId).apply()
            Log.i(TAG, "Generated permanent device installation ID: $generatedId")
        }
    }

    private fun createSecurePreferences(): SharedPreferences {
        return try {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()

            EncryptedSharedPreferences.create(
                context,
                "aurapos_secure_identity",
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (e: Exception) {
            Log.w(TAG, "Failed to initialize EncryptedSharedPreferences, falling back to standard: ${e.message}")
            context.getSharedPreferences("aurapos_device_identity_fallback", Context.MODE_PRIVATE)
        }
    }

    fun getDeviceInstallationId(): String {
        return prefs.getString(KEY_INSTALLATION_ID, "") ?: ""
    }

    fun getStoreId(): String {
        return prefs.getString(KEY_STORE_ID, "store_aura_main") ?: "store_aura_main"
    }

    fun getTerminalId(): String {
        return prefs.getString(KEY_TERMINAL_ID, "term_01") ?: "term_01"
    }

    fun getTerminalName(): String {
        return prefs.getString(KEY_TERMINAL_NAME, "Main POS Register") ?: "Main POS Register"
    }

    fun getActivationState(): ActivationState {
        val raw = prefs.getString(KEY_ACTIVATION_STATE, ActivationState.ACTIVE.name)
        return try {
            ActivationState.valueOf(raw ?: ActivationState.ACTIVE.name)
        } catch (e: Exception) {
            ActivationState.ACTIVE
        }
    }

    fun isTerminalActive(): Boolean {
        return getActivationState() == ActivationState.ACTIVE
    }

    /**
     * Activate / Register terminal
     */
    fun activateTerminal(storeId: String, terminalId: String, terminalName: String, activationToken: String): Boolean {
        prefs.edit()
            .putString(KEY_STORE_ID, storeId.trim())
            .putString(KEY_TERMINAL_ID, terminalId.trim())
            .putString(KEY_TERMINAL_NAME, terminalName.trim())
            .putString(KEY_ACTIVATION_TOKEN, activationToken)
            .putString(KEY_ACTIVATION_STATE, ActivationState.ACTIVE.name)
            .putLong(KEY_ACTIVATED_AT, System.currentTimeMillis())
            .apply()

        Log.i(TAG, "Terminal activated successfully: Store=$storeId, Terminal=$terminalId")
        return true
    }

    /**
     * Suspend terminal (prevents sales while preserving local data)
     */
    fun suspendTerminal(reason: String) {
        prefs.edit()
            .putString(KEY_ACTIVATION_STATE, ActivationState.SUSPENDED.name)
            .putString(KEY_SUSPENSION_REASON, reason)
            .putLong(KEY_SUSPENDED_AT, System.currentTimeMillis())
            .apply()

        Log.w(TAG, "Terminal SUSPENDED: $reason")
    }

    /**
     * Resume / Reactivate suspended terminal
     */
    fun resumeTerminal() {
        prefs.edit()
            .putString(KEY_ACTIVATION_STATE, ActivationState.ACTIVE.name)
            .remove(KEY_SUSPENSION_REASON)
            .apply()

        Log.i(TAG, "Terminal resumed to ACTIVE state.")
    }

    /**
     * Decommission terminal (scrubs credentials, removes authorization)
     */
    fun decommissionTerminal(): Boolean {
        prefs.edit()
            .putString(KEY_ACTIVATION_STATE, ActivationState.DECOMMISSIONED.name)
            .remove(KEY_ACTIVATION_TOKEN)
            .putLong(KEY_DECOMMISSIONED_AT, System.currentTimeMillis())
            .apply()

        Log.w(TAG, "Terminal DECOMMISSIONED.")
        return true
    }

    fun toJsonObject(): JSONObject {
        return JSONObject().apply {
            put("installationId", getDeviceInstallationId())
            put("storeId", getStoreId())
            put("terminalId", getTerminalId())
            put("terminalName", getTerminalName())
            put("activationState", getActivationState().name)
            put("isTerminalActive", isTerminalActive())
            put("deviceModel", "${Build.MANUFACTURER} ${Build.MODEL}")
            put("androidVersion", Build.VERSION.RELEASE)
            put("sdkInt", Build.VERSION.SDK_INT)
            put("suspensionReason", prefs.getString(KEY_SUSPENSION_REASON, null))
        }
    }

    companion object {
        private const val TAG = "DeviceIdentityManager"

        private const val KEY_INSTALLATION_ID = "device_installation_id"
        private const val KEY_STORE_ID = "store_id"
        private const val KEY_TERMINAL_ID = "terminal_id"
        private const val KEY_TERMINAL_NAME = "terminal_name"
        private const val KEY_ACTIVATION_STATE = "activation_state"
        private const val KEY_ACTIVATION_TOKEN = "activation_token"
        private const val KEY_ACTIVATED_AT = "activated_at"
        private const val KEY_SUSPENDED_AT = "suspended_at"
        private const val KEY_SUSPENSION_REASON = "suspension_reason"
        private const val KEY_DECOMMISSIONED_AT = "decommissioned_at"
    }
}
