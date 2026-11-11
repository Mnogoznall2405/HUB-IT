package ru.zsgp.hubit.folderzip

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.exception.toCodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.text.Normalizer
import java.util.UUID
import java.util.concurrent.Executors
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

private const val OPEN_FOLDER_CODE = 4218
private const val MAX_FOLDER_BYTES = 1024L * 1024L * 1024L
private const val MAX_FOLDER_FILES = 20_000
private const val MAX_FOLDER_DEPTH = 32

class HubitFolderZipModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
  private var pendingPromise: Promise? = null
  private val worker = Executors.newSingleThreadExecutor()

  override fun definition() = ModuleDefinition {
    Name("HubitFolderZip")

    AsyncFunction("pickAndZipFolderAsync") { promise: Promise ->
      if (pendingPromise != null) {
        promise.reject("ERR_FOLDER_PICK_IN_PROGRESS", "Folder selection is already in progress", null)
        return@AsyncFunction
      }
      pendingPromise = promise
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
      }
      appContext.throwingActivity.startActivityForResult(intent, OPEN_FOLDER_CODE)
    }

    OnActivityResult { _, (requestCode, resultCode, intent) ->
      if (requestCode != OPEN_FOLDER_CODE || pendingPromise == null) return@OnActivityResult
      val promise = pendingPromise ?: return@OnActivityResult
      pendingPromise = null
      if (resultCode != Activity.RESULT_OK || intent?.data == null) {
        promise.resolve(mapOf("canceled" to true))
        return@OnActivityResult
      }

      val treeUri = intent.data!!
      try {
        val takeFlags = intent.flags and (
          Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        )
        context.contentResolver.takePersistableUriPermission(treeUri, takeFlags)
      } catch (_: Exception) {
        // The temporary read grant is enough for immediate packing.
      }

      worker.execute {
        try {
          promise.resolve(packTree(treeUri))
        } catch (error: Exception) {
          promise.reject(error.toCodedException())
        }
      }
    }

    OnDestroy {
      pendingPromise?.reject("ERR_FOLDER_PICK_CANCELLED", "Folder selection was interrupted", null)
      pendingPromise = null
      worker.shutdownNow()
    }
  }

  private fun packTree(treeUri: Uri): Map<String, Any> {
    val resolver = context.contentResolver
    val rootDocumentId = DocumentsContract.getTreeDocumentId(treeUri)
    val rootUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, rootDocumentId)
    val rootName = readDisplayName(rootUri).ifBlank { "folder" }
    val safeRootName = sanitizeSegment(rootName)
    val outputDirectory = File(context.cacheDir, "hubit-folder-archives").apply { mkdirs() }
    val outputFile = File(outputDirectory, "${UUID.randomUUID()}-$safeRootName.zip")
    val stats = PackStats()
    val usedEntries = mutableSetOf<String>()

    try {
      ZipOutputStream(FileOutputStream(outputFile)).use { zip ->
        appendChildren(treeUri, rootDocumentId, "", 0, zip, stats, usedEntries)
      }
      if (stats.fileCount == 0) throw IllegalArgumentException("Выбранная папка пуста")
      if (!outputFile.exists() || outputFile.length() <= 0L) {
        throw IllegalStateException("Не удалось создать ZIP-архив")
      }
      if (outputFile.length() > MAX_FOLDER_BYTES) {
        throw IllegalArgumentException("ZIP-архив превышает 1 ГБ")
      }
      return mapOf(
        "canceled" to false,
        "asset" to mapOf(
          "uri" to Uri.fromFile(outputFile).toString(),
          "name" to "$safeRootName.zip",
          "mimeType" to "application/zip",
          "size" to outputFile.length().toDouble(),
          "fileCount" to stats.fileCount,
          "totalBytes" to stats.totalBytes.toDouble(),
          "folderName" to rootName.take(200)
        )
      )
    } catch (error: Exception) {
      outputFile.delete()
      throw error
    }
  }

  private fun appendChildren(
    treeUri: Uri,
    parentDocumentId: String,
    parentPath: String,
    depth: Int,
    zip: ZipOutputStream,
    stats: PackStats,
    usedEntries: MutableSet<String>
  ) {
    if (depth > MAX_FOLDER_DEPTH) throw IllegalArgumentException("Слишком глубокая структура папки")
    val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentDocumentId)
    val projection = arrayOf(
      DocumentsContract.Document.COLUMN_DOCUMENT_ID,
      DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      DocumentsContract.Document.COLUMN_MIME_TYPE,
      DocumentsContract.Document.COLUMN_SIZE
    )
    context.contentResolver.query(childrenUri, projection, null, null, null)?.use { cursor ->
      val idColumn = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
      val nameColumn = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
      val typeColumn = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_MIME_TYPE)
      val sizeColumn = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE)
      while (cursor.moveToNext()) {
        val documentId = cursor.getString(idColumn) ?: continue
        val displayName = cursor.getString(nameColumn).orEmpty()
        val mimeType = cursor.getString(typeColumn).orEmpty()
        val safeName = sanitizeSegment(displayName)
        val candidatePath = if (parentPath.isBlank()) safeName else "$parentPath/$safeName"
        if (mimeType == DocumentsContract.Document.MIME_TYPE_DIR) {
          appendChildren(treeUri, documentId, candidatePath, depth + 1, zip, stats, usedEntries)
          continue
        }

        stats.fileCount += 1
        if (stats.fileCount > MAX_FOLDER_FILES) {
          throw IllegalArgumentException("В папке больше $MAX_FOLDER_FILES файлов")
        }
        val declaredSize = if (sizeColumn >= 0 && !cursor.isNull(sizeColumn)) cursor.getLong(sizeColumn) else 0L
        if (declaredSize > MAX_FOLDER_BYTES || stats.totalBytes + declaredSize > MAX_FOLDER_BYTES) {
          throw IllegalArgumentException("Общий размер папки превышает 1 ГБ")
        }
        val documentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId)
        val entryName = uniqueEntryName(candidatePath, usedEntries)
        zip.putNextEntry(ZipEntry(entryName))
        var copied = 0L
        context.contentResolver.openInputStream(documentUri).use { input ->
          val source = input ?: throw IllegalStateException("Не удалось прочитать файл «${displayName.take(120)}»")
          val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
          while (true) {
            val read = source.read(buffer)
            if (read < 0) break
            copied += read
            if (stats.totalBytes + copied > MAX_FOLDER_BYTES) {
              throw IllegalArgumentException("Общий размер папки превышает 1 ГБ")
            }
            zip.write(buffer, 0, read)
          }
        }
        zip.closeEntry()
        stats.totalBytes += copied
      }
    } ?: throw IllegalStateException("Не удалось открыть выбранную папку")
  }

  private fun readDisplayName(uri: Uri): String {
    val projection = arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
    return context.contentResolver.query(uri, projection, null, null, null)?.use { cursor ->
      if (!cursor.moveToFirst()) "" else cursor.getString(0).orEmpty()
    }.orEmpty()
  }

  private fun sanitizeSegment(value: String): String {
    val normalized = Normalizer.normalize(value, Normalizer.Form.NFKC)
      .replace(Regex("[\\u0000-\\u001f\\u007f/\\\\:*?\"<>|]"), "_")
      .trim()
      .trim('.')
    val safe = if (normalized.isBlank() || normalized == "." || normalized == "..") "item" else normalized
    return safe.take(120)
  }

  private fun uniqueEntryName(candidate: String, usedEntries: MutableSet<String>): String {
    if (usedEntries.add(candidate)) return candidate
    val slash = candidate.lastIndexOf('/')
    val directory = if (slash >= 0) candidate.substring(0, slash + 1) else ""
    val fileName = candidate.substring(slash + 1)
    val dot = fileName.lastIndexOf('.')
    val base = if (dot > 0) fileName.substring(0, dot) else fileName
    val extension = if (dot > 0) fileName.substring(dot) else ""
    var suffix = 2
    while (true) {
      val next = "$directory$base ($suffix)$extension"
      if (usedEntries.add(next)) return next
      suffix += 1
    }
  }

  private data class PackStats(var fileCount: Int = 0, var totalBytes: Long = 0L)
}
