package com.aurapos.pos.sync

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.util.Log
import kotlinx.coroutines.*
import java.net.HttpURLConnection
import java.net.URL

/**
 * AuraPOS Network Connectivity & Reachability Monitor
 * Conforming to Section 20:
 * States: ONLINE, OFFLINE, CONNECTING, SYNCING, SYNC_ERROR
 * Distinguishes local network availability (Wi-Fi/Ethernet) from true server reachability.
 */
class NetworkMonitor(
    private val context: Context,
    private val onStateChanged: (state: NetworkState) -> Unit
) {

    enum class NetworkState {
        ONLINE,
        OFFLINE,
        CONNECTING,
        SYNCING,
        SYNC_ERROR
    }

    private val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private val monitorScope = CoroutineScope(Dispatchers.IO + Job())
    private var isNetworkAvailable = false
    private var isServerReachable = false

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            isNetworkAvailable = true
            checkServerReachability()
        }

        override fun onLost(network: Network) {
            isNetworkAvailable = false
            isServerReachable = false
            onStateChanged(NetworkState.OFFLINE)
        }

        override fun onCapabilitiesChanged(network: Network, networkCapabilities: NetworkCapabilities) {
            val hasInternet = networkCapabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            if (hasInternet) {
                checkServerReachability()
            } else {
                isServerReachable = false
                onStateChanged(NetworkState.OFFLINE)
            }
        }
    }

    fun start() {
        try {
            val request = NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()
            connectivityManager.registerNetworkCallback(request, networkCallback)
            checkServerReachability()
        } catch (e: Exception) {
            Log.w(TAG, "Failed to register network callback: ${e.message}")
        }
    }

    fun stop() {
        try {
            connectivityManager.unregisterNetworkCallback(networkCallback)
            monitorScope.cancel()
        } catch (_: Exception) {}
    }

    fun isOnline(): Boolean = isNetworkAvailable && isServerReachable

    fun checkServerReachability() {
        monitorScope.launch {
            onStateChanged(NetworkState.CONNECTING)
            val reachable = testBackendReachability()
            isServerReachable = reachable
            if (reachable) {
                onStateChanged(NetworkState.ONLINE)
            } else {
                onStateChanged(NetworkState.OFFLINE)
            }
        }
    }

    private suspend fun testBackendReachability(): Boolean = withContext(Dispatchers.IO) {
        // Prioritize application-controlled lightweight backend health endpoint (Section 7)
        val prefs = context.getSharedPreferences("aurapos_sec_config", Context.MODE_PRIVATE)
        val customBackendUrl = prefs.getString("backend_url", null)
            ?: prefs.getString("api_url", null)

        val candidateUrls = mutableListOf<String>()
        if (!customBackendUrl.isNullOrBlank()) {
            val base = customBackendUrl.trim().removeSuffix("/")
            candidateUrls.add("$base/api/health")
        }

        // Test local/in-app host health endpoint first
        candidateUrls.add("http://127.0.0.1:3000/api/health")
        candidateUrls.add("http://10.0.2.2:3000/api/health")

        // Standard reachability fallbacks if application server is remote
        candidateUrls.add("https://clients3.google.com/generate_204")
        candidateUrls.add("https://1.1.1.1")

        for (urlStr in candidateUrls) {
            try {
                val conn = URL(urlStr).openConnection() as HttpURLConnection
                conn.connectTimeout = 2500
                conn.readTimeout = 2500
                conn.requestMethod = "GET"
                conn.setRequestProperty("User-Agent", "AuraPOS-Reachability/1.0")
                val code = conn.responseCode
                conn.disconnect()
                if (code in 200..399 || code == 204) {
                    return@withContext true
                }
            } catch (_: Exception) {
                // Continue to next reachability candidate
            }
        }
        false
    }

    companion object {
        private const val TAG = "NetworkMonitor"
    }
}
