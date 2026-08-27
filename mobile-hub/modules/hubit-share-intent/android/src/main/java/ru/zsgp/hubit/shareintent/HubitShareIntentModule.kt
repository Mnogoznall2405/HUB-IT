package ru.zsgp.hubit.shareintent

import android.content.Intent
import java.util.UUID
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class HubitShareIntentModule : Module() {
  private var pendingIntent: Intent? = null

  override fun definition() = ModuleDefinition {
    Name("HubitShareIntent")
    Events("onShareIntent")

    OnNewIntent { intent ->
      if (isSupportedShare(intent)) {
        pendingIntent = Intent(intent)
        sendEvent("onShareIntent", mapOf("available" to true))
      }
    }

    AsyncFunction("getPendingShareAsync") {
      val activity = appContext.currentActivity ?: throw Exceptions.MissingActivity()
      val intent = pendingIntent ?: activity.intent
      if (!isSupportedShare(intent)) return@AsyncFunction null
      pendingIntent = null
      activity.intent = Intent(activity, activity::class.java).setAction(Intent.ACTION_MAIN)
      val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString().orEmpty().take(MAX_TEXT_LENGTH)
      val subject = intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT)?.toString().orEmpty().take(MAX_SUBJECT_LENGTH)
      if (text.isBlank()) return@AsyncFunction null
      mapOf(
        "id" to UUID.randomUUID().toString(),
        "text" to text,
        "subject" to subject,
        "mimeType" to (intent.type ?: "text/plain").take(MAX_MIME_LENGTH),
        "receivedAt" to System.currentTimeMillis().toDouble()
      )
    }
  }

  private fun isSupportedShare(intent: Intent?): Boolean {
    if (intent?.action != Intent.ACTION_SEND) return false
    val mimeType = intent.type.orEmpty().lowercase()
    return mimeType == "text/plain" || mimeType == "text/*"
  }

  private companion object {
    const val MAX_TEXT_LENGTH = 20_000
    const val MAX_SUBJECT_LENGTH = 500
    const val MAX_MIME_LENGTH = 100
  }
}
