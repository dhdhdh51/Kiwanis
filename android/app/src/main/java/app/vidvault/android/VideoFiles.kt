package app.vidvault.android

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.security.MessageDigest

data class PickedVideo(val uri: Uri, val name: String, val size: Long, val mime: String?)

object VideoFiles {
    val SUPPORTED = setOf("mp4", "mov", "mkv", "avi", "webm", "m4v")

    fun ext(name: String) = name.substringAfterLast('.', "").lowercase()

    /** Reads display name / size / type of a content Uri. */
    fun describe(context: Context, uri: Uri): PickedVideo? {
        val cr = context.contentResolver
        var name: String? = null
        var size = -1L
        cr.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                name = c.getString(0)
                if (!c.isNull(1)) size = c.getLong(1)
            }
        }
        if (size < 0) size = runCatching { cr.openFileDescriptor(uri, "r")?.use { it.statSize } ?: -1L }.getOrDefault(-1L)
        if (size <= 0) return null
        val mime = cr.getType(uri)
        var finalName = name ?: uri.lastPathSegment ?: "video"
        // Gallery names sometimes lack an extension — derive it from the MIME type.
        if (ext(finalName) !in SUPPORTED) {
            mimeExt(mime)?.let { finalName = "$finalName.$it" }
        }
        return PickedVideo(uri, finalName, size, mime)
    }

    private fun mimeExt(mime: String?) = when (mime?.lowercase()) {
        "video/mp4" -> "mp4"
        "video/quicktime" -> "mov"
        "video/x-matroska", "video/matroska" -> "mkv"
        "video/x-msvideo", "video/avi" -> "avi"
        "video/webm" -> "webm"
        "video/x-m4v" -> "m4v"
        else -> null
    }

    private const val SAMPLE = 4L * 1024 * 1024

    /**
     * Same fingerprint as the web app: SHA-256 over "size:" + first 4 MB + middle 1 MB + last 4 MB
     * (whole file when ≤ 12 MB). Lets the server resume interrupted uploads and detect duplicates.
     */
    fun fingerprint(cr: ContentResolver, uri: Uri, size: Long): String {
        val md = MessageDigest.getInstance("SHA-256")
        md.update("$size:".toByteArray())
        cr.openFileDescriptor(uri, "r")!!.use { pfd ->
            FileInputStream(pfd.fileDescriptor).channel.use { ch ->
                fun feed(start: Long, len: Long) {
                    val buf = ByteBuffer.allocate(256 * 1024)
                    var pos = start
                    val end = start + len
                    while (pos < end) {
                        buf.clear()
                        buf.limit(minOf(buf.capacity().toLong(), end - pos).toInt())
                        val n = ch.read(buf, pos)
                        if (n <= 0) break
                        md.update(buf.array(), 0, n)
                        pos += n
                    }
                }
                if (size <= SAMPLE * 3) feed(0, size)
                else {
                    val mid = size / 2
                    feed(0, SAMPLE)
                    feed(mid, 1024 * 1024)
                    feed(size - SAMPLE, SAMPLE)
                }
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }
}
