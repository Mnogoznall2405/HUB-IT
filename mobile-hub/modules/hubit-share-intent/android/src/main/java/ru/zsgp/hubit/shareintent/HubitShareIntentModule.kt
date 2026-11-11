package ru.zsgp.hubit.shareintent

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import java.io.File
import java.util.UUID
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class HubitShareIntentModule : Module() {
  private var pendingIntent: Intent? = null

  // Stream URIs of shares that were announced to JS but not yet copied: the read grant of a
  // share intent lives as long as the receiving activity, so files are copied only after the
  // user has chosen where to send them (a big video would otherwise delay the dialog).
  private val pendingStreams = LinkedHashMap<String, List<Uri>>()

  private data class StreamMeta(val name: String, val mimeType: String, val size: Long)

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
      val shareId = UUID.randomUUID().toString()
      val streams = extractStreams(intent, activity.packageName)
      val files = ArrayList<Map<String, Any>>()
      for (uri in streams) {
        val meta = readMeta(activity, uri, intent.type)
        files.add(
          mapOf(
            "name" to meta.name,
            "mimeType" to meta.mimeType,
            "size" to meta.size.coerceAtLeast(0L).toDouble()
          )
        )
      }
      if (text.isBlank() && files.isEmpty()) return@AsyncFunction null
      if (streams.isNotEmpty()) {
        pendingStreams[shareId] = streams
        while (pendingStreams.size > MAX_PENDING_SHARES) {
          val eldest = pendingStreams.keys.first()
          pendingStreams.remove(eldest)
        }
      }
      mapOf(
        "id" to shareId,
        "text" to text,
        "subject" to subject,
        "mimeType" to (intent.type ?: "text/plain").take(MAX_MIME_LENGTH),
        "receivedAt" to System.currentTimeMillis().toDouble(),
        "files" to files
      )
    }

    AsyncFunction("copySharedFilesAsync") { shareId: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val streams = pendingStreams.remove(shareId) ?: return@AsyncFunction ArrayList<Map<String, Any>>()
      val root = File(context.cacheDir, SHARE_CACHE_DIR)
      purgeStaleShares(root)
      val shareDir = File(root, shareId)
      shareDir.mkdirs()
      val copied = ArrayList<Map<String, Any>>()
      var totalBytes = 0L
      for ((index, uri) in streams.withIndex()) {
        val meta = readMeta(context, uri, null)
        if (meta.size > MAX_FILE_BYTES) continue
        val fileDir = File(shareDir, index.toString())
        fileDir.mkdirs()
        val target = File(fileDir, safeFileName(meta.name))
        var written = -1L
        try {
          val input = context.contentResolver.openInputStream(uri)
          if (input != null) {
            input.use { source ->
              target.outputStream().use { sink -> written = source.copyTo(sink) }
            }
          }
        } catch (error: Exception) {
          written = -1L
        }
        if (written > 0L && totalBytes + written <= MAX_TOTAL_BYTES) {
          totalBytes += written
          copied.add(
            mapOf(
              "uri" to Uri.fromFile(target).toString(),
              "name" to meta.name,
              "mimeType" to meta.mimeType,
              "size" to written.toDouble()
            )
          )
        } else {
          target.delete()
        }
      }
      copied
    }

    AsyncFunction("discardSharedFilesAsync") { shareId: String ->
      pendingStreams.remove(shareId)
      val context = appContext.reactContext
      if (context != null) {
        File(File(context.cacheDir, SHARE_CACHE_DIR), shareId).deleteRecursively()
      }
      Unit
    }
  }

  private fun isSupportedShare(intent: Intent?): Boolean {
    if (intent == null) return false
    if (intent.action == Intent.ACTION_SEND) {
      val mimeType = intent.type.orEmpty().lowercase()
      if (mimeType == "text/plain" || mimeType == "text/*") return true
      return intent.hasExtra(Intent.EXTRA_STREAM) || intent.clipData != null
    }
    if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
      return intent.hasExtra(Intent.EXTRA_STREAM) || intent.clipData != null
    }
    return false
  }

  @Suppress("DEPRECATION")
  private fun extractStreams(intent: Intent, ownPackage: String): List<Uri> {
    val uris = ArrayList<Uri>()
    if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
      val list: ArrayList<Uri>? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
      } else {
        intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
      }
      if (list != null) uris.addAll(list)
    } else {
      val single: Uri? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
      } else {
        intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
      }
      if (single != null) uris.add(single)
    }
    if (uris.isEmpty()) {
      val clip = intent.clipData
      if (clip != null) {
        for (index in 0 until clip.itemCount) {
          val uri = clip.getItemAt(index).uri
          if (uri != null) uris.add(uri)
        }
      }
    }
    return uris.filter { isTrustedStream(it, ownPackage) }.distinct().take(MAX_FILES)
  }

  // Only content:// streams of OTHER apps: a file:// URI or a provider of this very app would let a
  // foreign app make HUB-IT attach its own private files to a message.
  private fun isTrustedStream(uri: Uri, ownPackage: String): Boolean {
    if (uri.scheme != "content") return false
    val authority = uri.authority.orEmpty()
    return authority.isNotEmpty() && !authority.startsWith(ownPackage)
  }

  private fun readMeta(context: Context, uri: Uri, intentType: String?): StreamMeta {
    var name = ""
    var size = -1L
    try {
      val cursor = context.contentResolver.query(
        uri,
        arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
        null,
        null,
        null
      )
      if (cursor != null) {
        cursor.use {
          if (it.moveToFirst()) {
            val nameIndex = it.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            val sizeIndex = it.getColumnIndex(OpenableColumns.SIZE)
            if (nameIndex >= 0 && !it.isNull(nameIndex)) name = it.getString(nameIndex).orEmpty()
            if (sizeIndex >= 0 && !it.isNull(sizeIndex)) size = it.getLong(sizeIndex)
          }
        }
      }
    } catch (error: Exception) {
      // Metadata is best effort: the copy step reads the real size.
    }
    if (name.isBlank()) name = uri.lastPathSegment.orEmpty().substringAfterLast('/')
    if (name.isBlank()) name = "file"
    var mimeType = ""
    try {
      mimeType = context.contentResolver.getType(uri).orEmpty()
    } catch (error: Exception) {
      mimeType = ""
    }
    if (mimeType.isBlank() || mimeType.endsWith("/*")) {
      val extension = name.substringAfterLast('.', "").lowercase()
      val guessed = if (extension.isEmpty()) null else MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension)
      mimeType = guessed ?: intentType.orEmpty()
    }
    if (mimeType.isBlank() || mimeType.endsWith("/*")) mimeType = "application/octet-stream"
    return StreamMeta(name.take(MAX_NAME_LENGTH), mimeType.take(MAX_MIME_LENGTH), size)
  }

  private fun safeFileName(name: String): String {
    val cleaned = name.replace(Regex("[\\\\/:*?\"<>|\\u0000-\\u001f]"), "_").trim().trimStart('.')
    return if (cleaned.isEmpty()) "file" else cleaned.take(MAX_NAME_LENGTH)
  }

  private fun purgeStaleShares(root: File) {
    val cutoff = System.currentTimeMillis() - STALE_SHARE_MS
    val children = root.listFiles() ?: return
    for (child in children) {
      if (child.lastModified() < cutoff) child.deleteRecursively()
    }
  }

  private companion object {
    const val MAX_TEXT_LENGTH = 20_000
    const val MAX_SUBJECT_LENGTH = 500
    const val MAX_MIME_LENGTH = 100
    const val MAX_NAME_LENGTH = 180
    const val MAX_FILES = 10
    const val MAX_PENDING_SHARES = 3
    const val MAX_FILE_BYTES = 1024L * 1024L * 1024L
    const val MAX_TOTAL_BYTES = 1024L * 1024L * 1024L
    const val STALE_SHARE_MS = 24L * 60L * 60L * 1000L
    const val SHARE_CACHE_DIR = "hubit-share"
  }
}
