package com.aurapos.pos

import android.app.Application
import android.util.Log
import androidx.work.*
import com.aurapos.pos.data.AppDatabase
import com.aurapos.pos.data.LocalDatabaseHelper
import com.aurapos.pos.service.PrintQueueWorker
import com.aurapos.pos.sync.SyncEngine
import java.util.concurrent.TimeUnit

/**
 * AuraPOS Production Android Application Entry Point
 * Initializes local Room SQLite database, hardware drivers, sync engine, and background print queue worker.
 */
class POSApplication : Application() {

    lateinit var databaseHelper: LocalDatabaseHelper
        private set
    lateinit var appDatabase: AppDatabase
        private set
    lateinit var syncEngine: SyncEngine
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        Log.i(TAG, "Initializing AuraPOS Native Android Terminal Engine...")

        // 1. Initialize persistent local SQLite & Room databases
        databaseHelper = LocalDatabaseHelper(this)
        appDatabase = AppDatabase.getInstance(this)

        // 2. Initialize and start the centralized offline-first sync engine
        syncEngine = SyncEngine.getInstance(this)
        syncEngine.start()

        // 3. Schedule background print queue recovery worker
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
