package com.aurapos.pos.device

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Environment
import android.os.StatFs
import android.util.Log
import com.aurapos.pos.hardware.BluetoothPrinterManager
import com.aurapos.pos.hardware.NetworkPrinterManager
import org.json.JSONObject

/**
 * AuraPOS Watchdog & Health Monitor
 * Conforming to Sections 13, 20, 21:
 * - Aggregates application, database, hardware, network, battery, and storage metrics
 * - Computes overall health: HEALTHY, WARNING, DEGRADED, CRITICAL
 */
class DeviceHealthManager(
    private val context: Context,
    private val bluetoothManager: BluetoothPrinterManager?,
    private val networkManager: NetworkPrinterManager?
) {

    enum class HealthStatus {
        HEALTHY,
        WARNING,
        DEGRADED,
        CRITICAL
    }

    /**
     * Compute real authoritative POS terminal health
     */
    fun computeHealth(): JSONObject {
        val battery = getBatteryMetrics()
        val storage = getStorageMetrics()
        val memory = getMemoryMetrics()
        val bluetooth = bluetoothManager?.isBluetoothEnabled() ?: false
        val network = networkManager?.isNetworkAvailable() ?: false

        val batteryLevel = battery.optInt("percentage", 100)
        val isCharging = battery.optBoolean("isCharging", false)
        val storageFreeMb = storage.optLong("freeBytes", 0) / (1024 * 1024)
        val isLowMemory = memory.optBoolean("lowMemory", false)

        // Health assessment rules
        val status = when {
            storageFreeMb < 200 || (batteryLevel < 5 && !isCharging) -> HealthStatus.CRITICAL
            storageFreeMb < 500 || (batteryLevel < 15 && !isCharging) || isLowMemory -> HealthStatus.WARNING
            !network -> HealthStatus.DEGRADED // Offline mode is supported, so network absence is DEGRADED, not CRITICAL
            else -> HealthStatus.HEALTHY
        }

        return JSONObject().apply {
            put("status", status.name)
            put("battery", battery)
            put("storage", storage)
            put("memory", memory)
            put("bluetoothAvailable", bluetooth)
            put("networkAvailable", network)
            put("timestamp", System.currentTimeMillis())
        }
    }

    fun getBatteryMetrics(): JSONObject {
        return try {
            val ifilter = IntentFilter(Intent.ACTION_BATTERY_CHANGED)
            val batteryStatus = context.registerReceiver(null, ifilter)
            val level = batteryStatus?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
            val scale = batteryStatus?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
            val status = batteryStatus?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1

            val pct = if (level >= 0 && scale > 0) (level * 100 / scale) else 100
            val isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
                    status == BatteryManager.BATTERY_STATUS_FULL

            JSONObject().apply {
                put("percentage", pct)
                put("isCharging", isCharging)
                put("status", if (isCharging) "CHARGING" else "DISCHARGING")
            }
        } catch (e: Exception) {
            JSONObject().apply {
                put("percentage", 100)
                put("isCharging", true)
                put("status", "UNKNOWN")
            }
        }
    }

    fun getStorageMetrics(): JSONObject {
        return try {
            val stat = StatFs(Environment.getDataDirectory().path)
            val blockSize = stat.blockSizeLong
            val totalBlocks = stat.blockCountLong
            val availableBlocks = stat.availableBlocksLong

            val totalBytes = totalBlocks * blockSize
            val freeBytes = availableBlocks * blockSize
            val usedBytes = totalBytes - freeBytes

            val freePct = if (totalBytes > 0) (freeBytes * 100 / totalBytes) else 0

            JSONObject().apply {
                put("totalBytes", totalBytes)
                put("freeBytes", freeBytes)
                put("usedBytes", usedBytes)
                put("freePercentage", freePct)
                put("isLowStorage", freeBytes < 500 * 1024 * 1024) // < 500MB
            }
        } catch (e: Exception) {
            JSONObject().apply {
                put("totalBytes", 0)
                put("freeBytes", 0)
                put("freePercentage", 100)
                put("isLowStorage", false)
            }
        }
    }

    fun getMemoryMetrics(): JSONObject {
        return try {
            val am = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
            val memInfo = ActivityManager.MemoryInfo()
            am?.getMemoryInfo(memInfo)

            JSONObject().apply {
                put("totalMemBytes", memInfo.totalMem)
                put("availMemBytes", memInfo.availMem)
                put("lowMemory", memInfo.lowMemory)
            }
        } catch (e: Exception) {
            JSONObject().apply {
                put("lowMemory", false)
            }
        }
    }
}
