package com.aurapos.pos.service

import android.app.Service
import android.content.Intent
import android.os.IBinder

class BackgroundPrintService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }
}
