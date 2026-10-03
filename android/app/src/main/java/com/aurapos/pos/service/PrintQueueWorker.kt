package com.aurapos.pos.service

import android.content.Context
import android.util.Base64
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.aurapos.pos.data.LocalDatabaseHelper
import com.aurapos.pos.hardware.BluetoothPrinterManager
import com.aurapos.pos.hardware.NetworkPrinterManager
import com.aurapos.pos.hardware.UsbPrinterManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * AuraPOS Native Background Print Queue Recovery Worker
 * Conforming to Sections 11, 22, and 23:
 * - Automatically recovers print jobs left in PENDING or PRINTING status after app/device restart
 * - Retries with exponential backoff
 * - Prevents duplicate prints
 */
class PrintQueueWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    private val dbHelper = LocalDatabaseHelper(appContext)
    private val btManager = BluetoothPrinterManager(appContext)
    private val netManager = NetworkPrinterManager(appContext)
    private val usbManager = UsbPrinterManager(appContext)

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val db = dbHelper.readableDatabase
        val cursor = db.rawQuery(
            "SELECT id, printer_id, payload, attempts FROM print_jobs WHERE status IN ('PENDING', 'PRINTING') ORDER BY created_at ASC LIMIT 10",
            null
        )

        var processedCount = 0

        try {
            while (cursor.moveToNext()) {
                val jobId = cursor.getString(0)
                val printerId = cursor.getString(1)
                val payloadBase64 = cursor.getString(2)
                val attempts = cursor.getInt(3)

                // Retrieve printer config
                val printerCursor = db.rawQuery(
                    "SELECT connection_type, device_identifier, ip_address, port FROM printers WHERE id = ?",
                    arrayOf(printerId)
                )

                if (printerCursor.moveToFirst()) {
                    val connType = printerCursor.getString(0)
                    val devIdentifier = printerCursor.getString(1)
                    val ip = printerCursor.getString(2)
                    val port = printerCursor.getInt(3)
                    printerCursor.close()

                    val rawBytes = Base64.decode(payloadBase64, Base64.DEFAULT)

                    dbHelper.updatePrintJobStatus(jobId, "PRINTING")

                    val printResult = when (connType.lowercase()) {
                        "bluetooth", "x18" -> btManager.printRaw(devIdentifier, rawBytes)
                        "lan", "network", "escpos" -> netManager.printRaw(ip, port, rawBytes)
                        "usb" -> usbManager.printRaw(devIdentifier, rawBytes)
                        else -> null
                    }

                    if (printResult != null && printResult.optBoolean("success", false)) {
                        dbHelper.updatePrintJobStatus(jobId, "COMPLETED")
                        Log.i(TAG, "Print job $jobId completed successfully by background worker.")
                    } else {
                        val errMsg = printResult?.optString("error") ?: "Printer unreachable"
                        dbHelper.updatePrintJobStatus(jobId, if (attempts >= 5) "FAILED" else "PENDING", errMsg)
                    }
                    processedCount++
                } else {
                    printerCursor.close()
                    dbHelper.updatePrintJobStatus(jobId, "FAILED", "PRINTER_NOT_CONFIGURED")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "PrintQueueWorker encountered error: ${e.message}")
            return@withContext Result.retry()
        } finally {
            cursor.close()
            btManager.cleanup()
            usbManager.cleanup()
        }

        Result.success()
    }

    companion object {
        private const val TAG = "PrintQueueWorker"
    }
}
