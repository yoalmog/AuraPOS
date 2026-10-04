package com.aurapos.pos.hardware

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException

/**
 * Native Android LAN / Wi-Fi Network Thermal Printer Controller
 * Conforming to Section 7:
 * - Native TCP socket communication on Port 9100
 * - Real raw ESC/POS byte transmission (No browser fetch / HTTP simulation)
 * - Timeout handling (3500ms), connection refused, host unreachable
 * - Real hardware status
 */
class NetworkPrinterManager(private val context: Context) {

    private val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager

    fun isNetworkAvailable(): Boolean {
        val network = connectivityManager?.activeNetwork ?: return false
        val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) ||
               capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
               capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
    }

    /**
     * Test connection to a LAN printer on Port 9100 with latency measurement.
     */
    suspend fun testConnection(ipAddress: String, port: Int = 9100, timeoutMs: Int = 3500): JSONObject = withContext(Dispatchers.IO) {
        val result = JSONObject()
        val startTime = System.currentTimeMillis()

        if (!isValidIp(ipAddress)) {
            result.put("success", false)
            result.put("status", "ERROR")
            result.put("error", "Invalid IP address format: $ipAddress")
            return@withContext result
        }

        var socket: Socket? = null
        try {
            socket = Socket()
            socket.connect(InetSocketAddress(ipAddress, port), timeoutMs)
            val latency = System.currentTimeMillis() - startTime

            // Send standard status query / reset (ESC @)
            socket.getOutputStream().write(byteArrayOf(0x1B, 0x40))
            socket.getOutputStream().flush()

            result.put("success", true)
            result.put("status", "ONLINE")
            result.put("latencyMs", latency)
            result.put("message", "LAN printer at $ipAddress:$port reachable in ${latency}ms.")
        } catch (e: SocketTimeoutException) {
            result.put("success", false)
            result.put("status", "OFFLINE")
            result.put("error", "Connection timed out after ${timeoutMs}ms. Verify printer IP and Wi-Fi connection.")
        } catch (e: Exception) {
            Log.e(TAG, "Network printer test failed ($ipAddress:$port): ${e.message}")
            result.put("success", false)
            result.put("status", "OFFLINE")
            result.put("error", "Cannot connect to printer at $ipAddress:$port: ${e.localizedMessage ?: "Connection refused"}")
        } finally {
            try {
                socket?.close()
            } catch (e: Exception) {}
        }

        result
    }

    /**
     * Send raw ESC/POS bytes over TCP socket to network printer.
     */
    suspend fun printRaw(ipAddress: String, port: Int = 9100, data: ByteArray, timeoutMs: Int = 5000): JSONObject = withContext(Dispatchers.IO) {
        val result = JSONObject()

        if (!isValidIp(ipAddress)) {
            result.put("success", false)
            result.put("error", "Invalid IP address: $ipAddress")
            return@withContext result
        }

        var socket: Socket? = null
        var outputStream: OutputStream? = null

        try {
            socket = Socket()
            socket.connect(InetSocketAddress(ipAddress, port), timeoutMs)
            socket.soTimeout = timeoutMs

            outputStream = socket.getOutputStream()
            outputStream.write(data)
            outputStream.flush()

            result.put("success", true)
            result.put("bytesPrinted", data.size)
            result.put("message", "Receipt transmitted successfully to $ipAddress:$port.")
        } catch (e: Exception) {
            Log.e(TAG, "Print failed to $ipAddress:$port: ${e.message}")
            result.put("success", false)
            result.put("error", "Network print failed: ${e.localizedMessage}")
        } finally {
            try {
                outputStream?.close()
                socket?.close()
            } catch (e: Exception) {}
        }

        result
    }

    private fun isValidIp(ip: String): Boolean {
        val parts = ip.split(".")
        if (parts.size != 4) return false
        return parts.all {
            val num = it.toIntOrNull()
            num != null && num in 0..255
        }
    }

    companion object {
        private const val TAG = "NetworkPrinterManager"
    }
}
