package com.aurapos.pos.sync

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

/**
 * AuraPOS WorkManager Background Sync Worker
 * Conforming to Section 22:
 * - Runs with network constraints (NetworkType.CONNECTED)
 * - Exponential backoff retry
 * - Respects Android battery and background restrictions
 */
class SyncWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    override suspend fun doWork(): Result {
        Log.i(TAG, "Starting background WorkManager synchronization cycle...")
        return try {
            val syncEngine = SyncEngine.getInstance(applicationContext)
            val result = syncEngine.syncNow()
            val success = result.optBoolean("success", false)
            if (success) {
                Log.i(TAG, "Background sync completed successfully.")
                Result.success()
            } else {
                Log.w(TAG, "Background sync had issues, retrying with backoff...")
                Result.retry()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Background sync exception: ${e.message}", e)
            Result.retry()
        }
    }

    companion object {
        private const val TAG = "SyncWorker"
    }
}
