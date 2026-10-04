package com.aurapos.pos.hardware

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Build
import android.os.IBinder
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

/**
 * BuiltInPrinterManager - Driver for integrated / built-in thermal printers on Android POS Terminals.
 * Supports:
 * 1. Sunmi POS Terminals (V1, V1s, V2, V2 Pro, T1, T2, P2, etc.) via Woyou AIDL Service
 * 2. Handheld POS internal serial thermal printers (/dev/ttyS*, /dev/ttyHSL*, /dev/ttyMT*)
 * 3. Status reporting (ONLINE / OFFLINE) and automatic binding
 */
class BuiltInPrinterManager(private val context: Context) {

    private val TAG = "BuiltInPrinterManager"
    private var sunmiServiceBinder: IBinder? = null
    private var isSunmiBound = false
    private var isSunmiDevice = false

    private val sunmiConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            Log.i(TAG, "Connected to Sunmi internal thermal printer service.")
            sunmiServiceBinder = service
            isSunmiBound = true
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            Log.w(TAG, "Disconnected from Sunmi printer service.")
            sunmiServiceBinder = null
            isSunmiBound = false
        }
    }

    init {
        checkAndBindSunmiService()
    }

    private fun checkAndBindSunmiService() {
        try {
            val manufacturer = Build.MANUFACTURER.lowercase()
            val brand = Build.BRAND.lowercase()
            val model = Build.MODEL.lowercase()
            isSunmiDevice = manufacturer.contains("sunmi") || brand.contains("sunmi") || model.contains("sunmi")

            val intent = Intent()
            intent.`package` = "woyou.aidlservice.jiuqi"
            intent.action = "woyou.aidlservice.jiuqi.IWoyouService"

            val resolveInfo = context.packageManager.queryIntentServices(intent, 0)
            if (resolveInfo.isNotEmpty() || isSunmiDevice) {
                val bound = context.bindService(intent, sunmiConnection, Context.BIND_AUTO_CREATE)
                Log.i(TAG, "Sunmi internal printer service bind initiated: $bound")
            }
        } catch (e: Exception) {
            Log.w(TAG, "Sunmi service check error: ${e.message}")
        }
    }

    /**
     * Check if this device has a detected built-in / integrated thermal printer
     */
    fun hasBuiltInPrinter(): Boolean {
        if (isSunmiBound || isSunmiDevice) return true
        // Check for common internal POS serial ports
        val commonSerialPorts = listOf("/dev/ttyS1", "/dev/ttyS0", "/dev/ttyHSL1", "/dev/ttyMT1", "/dev/ttyUSB0")
        for (path in commonSerialPorts) {
            val f = File(path)
            if (f.exists() && f.canWrite()) {
                return true
            }
        }
        return false
    }

    fun getBuiltInPrinterInfo(): JSONObject? {
        if (!hasBuiltInPrinter()) return null

        val printerName = if (isSunmiDevice || isSunmiBound) {
            "Sunmi Built-in Thermal (${Build.MODEL})"
        } else {
            "Integrated POS Terminal Printer (${Build.MODEL})"
        }

        return JSONObject().apply {
            put("id", "prn_builtin_internal")
            put("name", printerName)
            put("type", "builtin")
            put("connectionType", "builtin")
            put("status", if (isSunmiBound || hasBuiltInPrinter()) "ONLINE" else "OFFLINE")
            put("paperWidth", 58)
            put("charactersPerLine", 32)
            put("supportsCut", false)
            put("supportsCashDrawer", true)
        }
    }

    /**
     * Send raw ESC/POS bytes to the built-in printer
     */
    suspend fun printRaw(data: ByteArray): JSONObject = withContext(Dispatchers.IO) {
        val result = JSONObject()

        // 1. Try Sunmi AIDL service if available
        if (sunmiServiceBinder != null) {
            try {
                // Call sendRAWData via AIDL reflection
                val woyouClass = Class.forName("woyou.aidlservice.jiuqi.IWoyouService\$Stub")
                val asInterfaceMethod = woyouClass.getMethod("asInterface", IBinder::class.java)
                val woyouService = asInterfaceMethod.invoke(null, sunmiServiceBinder)

                if (woyouService != null) {
                    val sendRawMethod = woyouService.javaClass.getMethod(
                        "sendRAWData",
                        ByteArray::class.java,
                        Class.forName("woyou.aidlservice.jiuqi.ICallback")
                    )
                    sendRawMethod.invoke(woyouService, data, null)

                    // Also feed paper to tear bar
                    val lineWrapMethod = woyouService.javaClass.getMethod(
                        "lineWrap",
                        Int::class.javaPrimitiveType,
                        Class.forName("woyou.aidlservice.jiuqi.ICallback")
                    )
                    lineWrapMethod.invoke(woyouService, 3, null)

                    result.put("success", true)
                    result.put("bytesPrinted", data.size)
                    result.put("protocol", "SUNMI_AIDL_INTERNAL")
                    result.put("message", "Printed to Sunmi integrated thermal printer.")
                    return@withContext result
                }
            } catch (sunmiErr: Exception) {
                Log.w(TAG, "Sunmi reflection print failed: ${sunmiErr.message}. Trying direct binder...")
                try {
                    // Direct Parcel writing to Sunmi transaction 19 (sendRAWData)
                    val dataParcel = android.os.Parcel.obtain()
                    val replyParcel = android.os.Parcel.obtain()
                    try {
                        dataParcel.writeInterfaceToken("woyou.aidlservice.jiuqi.IWoyouService")
                        dataParcel.writeByteArray(data)
                        dataParcel.writeStrongBinder(null)
                        sunmiServiceBinder?.transact(19, dataParcel, replyParcel, 0)
                        replyParcel.readException()

                        result.put("success", true)
                        result.put("bytesPrinted", data.size)
                        result.put("protocol", "SUNMI_PARCEL_INTERNAL")
                        result.put("message", "Dispatched to Sunmi built-in printer.")
                        return@withContext result
                    } finally {
                        dataParcel.recycle()
                        replyParcel.recycle()
                    }
                } catch (parcelErr: Exception) {
                    Log.e(TAG, "Sunmi Parcel write failed: ${parcelErr.message}")
                }
            }
        }

        // 2. Try internal POS serial ports
        val commonSerialPorts = listOf("/dev/ttyS1", "/dev/ttyS0", "/dev/ttyHSL1", "/dev/ttyMT1", "/dev/ttyUSB0")
        for (portPath in commonSerialPorts) {
            val file = File(portPath)
            if (file.exists() && file.canWrite()) {
                try {
                    val fos = FileOutputStream(file)
                    fos.write(data)
                    fos.flush()
                    fos.close()

                    result.put("success", true)
                    result.put("bytesPrinted", data.size)
                    result.put("protocol", "SERIAL_INTERNAL_$portPath")
                    result.put("message", "Printed to internal serial printer on $portPath.")
                    return@withContext result
                } catch (e: Exception) {
                    Log.w(TAG, "Serial print to $portPath failed: ${e.message}")
                }
            }
        }

        result.put("success", false)
        result.put("error", "No integrated / built-in thermal printer hardware ready. Connect an external Bluetooth, LAN, or USB printer.")
        result
    }

    fun cleanup() {
        if (isSunmiBound) {
            try {
                context.unbindService(sunmiConnection)
                isSunmiBound = false
            } catch (_: Exception) {}
        }
    }
}
