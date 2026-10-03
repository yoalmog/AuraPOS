package com.aurapos.pos.device

import android.content.ContentValues
import android.content.Context
import android.util.Log
import com.aurapos.pos.data.LocalDatabaseHelper
import org.json.JSONArray
import org.json.JSONObject

/**
 * AuraPOS Immutable Security Audit Manager
 * Conforming to Section 24:
 * Records security-sensitive operations in local SQLite database:
 * - login, logout, failed login
 * - refund, void, discount override, price override
 * - cash drawer open, cash in, cash out
 * - printer/terminal config changes, kiosk enter/exit
 * - device activation, suspension, decommission
 */
class AuditManager(
    private val context: Context,
    private val dbHelper: LocalDatabaseHelper
) {

    init {
        createAuditTableIfNotExists()
    }

    private fun createAuditTableIfNotExists() {
        try {
            val db = dbHelper.writableDatabase
            db.execSQL("""
                CREATE TABLE IF NOT EXISTS security_audit_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp INTEGER NOT NULL,
                    user_id TEXT NOT NULL,
                    user_role TEXT NOT NULL,
                    terminal_id TEXT NOT NULL,
                    action TEXT NOT NULL,
                    entity TEXT,
                    details TEXT,
                    result TEXT NOT NULL
                );
            """.trimIndent())
        } catch (e: Exception) {
            Log.e(TAG, "Failed to create security_audit_logs table: ${e.message}", e)
        }
    }

    fun logEvent(
        userId: String,
        userRole: String,
        terminalId: String,
        action: String,
        entity: String?,
        details: String?,
        result: String
    ): Boolean {
        return try {
            val db = dbHelper.writableDatabase
            val values = ContentValues().apply {
                put("timestamp", System.currentTimeMillis())
                put("user_id", userId)
                put("user_role", userRole)
                put("terminal_id", terminalId)
                put("action", action)
                put("entity", entity)
                put("details", details)
                put("result", result)
            }
            db.insert("security_audit_logs", null, values) != -1L
        } catch (e: Exception) {
            Log.e(TAG, "Failed to insert audit log: ${e.message}", e)
            false
        }
    }

    fun getRecentLogs(limit: Int = 50): JSONArray {
        val array = JSONArray()
        try {
            val db = dbHelper.readableDatabase
            val cursor = db.rawQuery(
                "SELECT * FROM security_audit_logs ORDER BY timestamp DESC LIMIT ?",
                arrayOf(limit.toString())
            )
            while (cursor.moveToNext()) {
                val item = JSONObject().apply {
                    put("id", cursor.getLong(cursor.getColumnIndexOrThrow("id")))
                    put("timestamp", cursor.getLong(cursor.getColumnIndexOrThrow("timestamp")))
                    put("userId", cursor.getString(cursor.getColumnIndexOrThrow("user_id")))
                    put("userRole", cursor.getString(cursor.getColumnIndexOrThrow("user_role")))
                    put("terminalId", cursor.getString(cursor.getColumnIndexOrThrow("terminal_id")))
                    put("action", cursor.getString(cursor.getColumnIndexOrThrow("action")))
                    put("entity", cursor.getString(cursor.getColumnIndexOrThrow("entity")))
                    put("details", cursor.getString(cursor.getColumnIndexOrThrow("details")))
                    put("result", cursor.getString(cursor.getColumnIndexOrThrow("result")))
                }
                array.put(item)
            }
            cursor.close()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to query audit logs: ${e.message}", e)
        }
        return array
    }

    companion object {
        private const val TAG = "AuraAuditManager"
    }
}
