package com.aurapos.pos

import android.app.Application
import android.util.Log
import androidx.work.*
import com.aurapos.pos.data.LocalDatabaseHelper
import com.aurapos.pos.service.PrintQueueWorker
import java.util.concurrent.TimeUnit

/**
 * AuraPOS Production Android Application Entry Point
 * Initializes local SQLite database, hardware drivers, and background print queue worker.
 */
class POSApplication : Application() {

    lateinit var databaseHelper: LocalDatabaseHelper
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        Log.i(TAG, "Initializing AuraPOS Native Android Terminal Engine...")

        // 1. Initialize persistent local database
        databaseHelper = LocalDatabaseHelper(this)

        // 2. Schedule background print queue recovery worker
        schedulePrintQueueWorker()
    }

    private fun schedulePrintQueueWorker() {
        val constraints = Constraints.Builder()
            .setRequiresBatteryNotLow(false)
            .build()

        val periodicWork = PeriodicWorkRequestBuilder<PrintQueueWorker>(15, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
            .build()

        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            "AuraPOS_PrintQueueWorker",
            ExistingPeriodicWorkPolicy.KEEP,
            periodicWork
        )
    }

    companion object {
        private const val TAG = "POSApplication"
        lateinit var instance: POSApplication
            private set
    }
}
