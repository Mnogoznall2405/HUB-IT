package ru.zsgp.hubit.devicehealth

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class HubitDeviceHealthModule : Module() {
  private var connectivityCallback: ConnectivityManager.NetworkCallback? = null

  override fun definition() = ModuleDefinition {
    Name("HubitDeviceHealth")
    Events(CONNECTIVITY_EVENT_NAME)

    OnStartObserving(CONNECTIVITY_EVENT_NAME) {
      startConnectivityObserving()
    }

    OnStopObserving(CONNECTIVITY_EVENT_NAME) {
      stopConnectivityObserving()
    }

    OnDestroy {
      stopConnectivityObserving()
    }

    AsyncFunction("getConnectivityAsync") {
      connectivitySnapshot()
    }

    AsyncFunction("getHistoricalProcessExitInfoAsync") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
        return@AsyncFunction mapOf(
          "supported" to false,
          "entries" to emptyList<Map<String, Any>>()
        )
      }

      val context = appContext.reactContext
        ?: return@AsyncFunction mapOf(
          "supported" to true,
          "entries" to emptyList<Map<String, Any>>()
        )
      val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
        ?: return@AsyncFunction mapOf(
          "supported" to true,
          "entries" to emptyList<Map<String, Any>>()
        )

      val entries = try {
        activityManager
          .getHistoricalProcessExitReasons(context.packageName, 0, MAX_EXIT_RECORDS)
          .sortedByDescending { it.timestamp }
          .take(MAX_EXIT_RECORDS)
          .map { exitInfo ->
            mapOf(
              "timestampMs" to exitInfo.timestamp.toDouble(),
              "reason" to normalizeReason(exitInfo.reason)
            )
          }
      } catch (_: Exception) {
        emptyList()
      }

      mapOf(
        "supported" to true,
        "entries" to entries
      )
    }
  }

  private fun connectivityManager(): ConnectivityManager? {
    val context = appContext.reactContext ?: return null
    return context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
  }

  private fun connectivitySnapshot(): Map<String, Any> {
    val manager = connectivityManager()
    val capabilities = manager?.activeNetwork?.let(manager::getNetworkCapabilities)
    val connected = capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
    val online = connected
      && capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true
    return mapOf(
      "online" to online,
      "connected" to connected,
      "transport" to normalizeTransport(capabilities),
      "metered" to (manager?.isActiveNetworkMetered ?: false),
      "changedAtMs" to System.currentTimeMillis().toDouble()
    )
  }

  private fun normalizeTransport(capabilities: NetworkCapabilities?): String = when {
    capabilities == null -> "none"
    capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "vpn"
    capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
    capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
    capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
    capabilities.hasTransport(NetworkCapabilities.TRANSPORT_BLUETOOTH) -> "bluetooth"
    else -> "other"
  }

  private fun emitConnectivitySnapshot() {
    try {
      sendEvent(CONNECTIVITY_EVENT_NAME, connectivitySnapshot())
    } catch (_: Exception) {
      // Connectivity is advisory; a listener failure must not affect the app lifecycle.
    }
  }

  private fun startConnectivityObserving() {
    if (connectivityCallback != null) return
    val manager = connectivityManager() ?: return
    val callback = object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) = emitConnectivitySnapshot()
      override fun onLost(network: Network) = emitConnectivitySnapshot()
      override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) =
        emitConnectivitySnapshot()
    }
    connectivityCallback = callback
    try {
      manager.registerDefaultNetworkCallback(callback)
      emitConnectivitySnapshot()
    } catch (_: Exception) {
      connectivityCallback = null
    }
  }

  private fun stopConnectivityObserving() {
    val callback = connectivityCallback ?: return
    connectivityCallback = null
    try {
      connectivityManager()?.unregisterNetworkCallback(callback)
    } catch (_: Exception) {
      // The callback can already be unregistered during React context teardown.
    }
  }

  private fun normalizeReason(reason: Int): String = when (reason) {
    ApplicationExitInfo.REASON_ANR -> "anr"
    ApplicationExitInfo.REASON_CRASH -> "crash"
    ApplicationExitInfo.REASON_CRASH_NATIVE -> "native_crash"
    ApplicationExitInfo.REASON_LOW_MEMORY -> "low_memory"
    ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "excessive_resource"
    ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> "initialization_failure"
    ApplicationExitInfo.REASON_DEPENDENCY_DIED -> "dependency_died"
    ApplicationExitInfo.REASON_PERMISSION_CHANGE -> "permission_change"
    ApplicationExitInfo.REASON_USER_REQUESTED -> "user_requested"
    ApplicationExitInfo.REASON_USER_STOPPED -> "user_stopped"
    ApplicationExitInfo.REASON_EXIT_SELF -> "exit_self"
    ApplicationExitInfo.REASON_SIGNALED -> "signaled"
    ApplicationExitInfo.REASON_FREEZER -> "freezer"
    ApplicationExitInfo.REASON_PACKAGE_STATE_CHANGE -> "package_state_change"
    ApplicationExitInfo.REASON_PACKAGE_UPDATED -> "package_updated"
    else -> "other"
  }

  private companion object {
    const val MAX_EXIT_RECORDS = 20
    const val CONNECTIVITY_EVENT_NAME = "onConnectivityChanged"
  }
}
