package app.vidvault.android

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.MediaType
import okhttp3.Request
import okhttp3.RequestBody
import okio.BufferedSink
import org.json.JSONArray
import org.json.JSONObject
import java.io.FileInputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/**
 * Uploads one video in the background (WorkManager + foreground service notification).
 *
 *  - Survives the app being closed, the screen turning off and process death.
 *  - Waits for network (or Wi-Fi only) and retries with exponential backoff.
 *  - Resumable: on every (re)start the server reports which chunks it already has, so
 *    only the missing chunks are sent — an interrupted 2 GB upload continues where it stopped.
 */
class UploadWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    private val api = Api(ctx)
    private val uri = Uri.parse(inputData.getString(K_URI))
    private val name = inputData.getString(K_NAME) ?: "video"
    private val size = inputData.getLong(K_SIZE, 0)
    private val mime = inputData.getString(K_MIME)
    private val folderId = inputData.getString(K_FOLDER)
    private val allowDuplicate = inputData.getBoolean(K_ALLOW_DUP, false)
    private val notifId = id.hashCode()

    private val sent = AtomicLong(0)
    private var uploadId: String? = null
    private var lastReport = 0L
    private var lastBytes = 0L
    private var lastTime = 0L
    private var speed = 0.0

    override suspend fun getForegroundInfo(): ForegroundInfo = foreground(0, 0)

    override suspend fun doWork(): Result {
        if (api.prefs.token == null) return fail("NOT_SIGNED_IN", applicationContext.getString(R.string.err_signed_out))
        runCatching { setForeground(foreground(0, 0)) } // may be refused when started from the background; work still runs
        return try {
            report("preparing", force = true)
            val fp = withContext(Dispatchers.IO) { VideoFiles.fingerprint(applicationContext.contentResolver, uri, size) }

            val body = JSONObject()
                .put("filename", name)
                .put("size", size)
                .put("fingerprint", fp)
            mime?.let { body.put("mimeType", it) }
            body.put("folderId", folderId ?: JSONObject.NULL)
            if (allowDuplicate) body.put("allowDuplicate", true)
            val session = api.post("/api/uploads", body)
            val id = session.getString("uploadId").also { uploadId = it }
            val chunkSize = session.getLong("chunkSize")
            val total = session.getInt("totalChunks")
            val done = Api.ints(session.optJSONArray("uploadedParts")).toSet()
            sent.set(session.optLong("uploadedBytes", 0))
            report("uploading", force = true)

            uploadParts(id, chunkSize, total, (1..total).filter { it !in done })

            report("finalizing", force = true)
            var video: JSONObject? = null
            for (pass in 0 until 3) {
                try {
                    video = api.post("/api/uploads/$id/complete").getJSONObject("video")
                    break
                } catch (e: ApiException) {
                    if (e.code != "UPLOAD_INCOMPLETE" || pass == 2) throw e
                    val missing = Api.ints(e.details?.optJSONArray("missingParts"))
                    uploadParts(id, chunkSize, total, missing)
                }
            }
            Notifier.done(applicationContext, notifId, name, true, null)
            Result.success(workDataOf(K_STATE to "completed", K_VIDEO_ID to video!!.getString("id"), K_BYTES to size, K_TOTAL to size))
        } catch (e: CancellationException) {
            throw e
        } catch (e: ApiException) {
            when {
                e.code == "DUPLICATE" -> fail("DUPLICATE", e.message ?: "Already uploaded")
                e.status == 401 -> fail("NOT_SIGNED_IN", applicationContext.getString(R.string.err_signed_out))
                e.retriable && runAttemptCount < MAX_ATTEMPTS -> retryLater(e.message)
                else -> fail(e.code, e.message ?: "Upload failed")
            }
        } catch (e: SecurityException) {
            fail("NO_ACCESS", applicationContext.getString(R.string.err_file_access))
        } catch (e: IOException) {
            if (runAttemptCount < MAX_ATTEMPTS) retryLater(e.message) else fail("NETWORK", applicationContext.getString(R.string.err_network))
        }
    }

    private suspend fun uploadParts(id: String, chunkSize: Long, total: Int, pending: List<Int>) {
        if (pending.isEmpty()) return
        val queue = ArrayDeque(pending)
        val lock = Mutex()
        val urls = HashMap<Int, String>()
        val parallel = api.prefs.parallelChunks

        suspend fun urlFor(n: Int): String = lock.withLock {
            urls.remove(n)?.let { return@withLock it }
            // Presign this part plus the next few queued ones in one request.
            val batch = (listOf(n) + queue.take(19)).distinct()
            val r = api.post("/api/uploads/$id/parts", JSONObject().put("partNumbers", JSONArray(batch)))
            val parts = r.getJSONArray("parts")
            for (i in 0 until parts.length()) {
                val p = parts.getJSONObject(i)
                urls[p.getInt("partNumber")] = p.getString("url")
            }
            urls.remove(n)!!
        }

        suspend fun next(): Int? = lock.withLock { queue.removeFirstOrNull() }

        coroutineScope {
            (0 until minOf(parallel, pending.size)).map {
                async(Dispatchers.IO) {
                    while (true) {
                        if (isStopped) throw CancellationException("stopped")
                        val n = next() ?: break
                        val start = (n - 1) * chunkSize
                        val len = if (n < total) chunkSize else size - chunkSize * (total - 1)
                        putPart(urlFor(n), start, len)
                        if (n % 4 == 0) runCatching { api.post("/api/uploads/$id/progress", JSONObject().put("uploadedBytes", sent.get())) }
                    }
                }
            }.awaitAll()
        }
    }

    /** Streams one chunk from the file straight to storage (no full-chunk buffering in memory). */
    private fun putPart(url: String, start: Long, len: Long) {
        var counted = 0L
        val body = object : RequestBody() {
            override fun contentType(): MediaType? = null
            override fun contentLength() = len
            override fun writeTo(sink: BufferedSink) {
                // OkHttp may call writeTo again on retry — undo progress from a previous attempt.
                sent.addAndGet(-counted)
                counted = 0
                applicationContext.contentResolver.openFileDescriptor(uri, "r")!!.use { pfd ->
                    FileInputStream(pfd.fileDescriptor).channel.use { ch ->
                        val buf = ByteBuffer.allocate(128 * 1024)
                        var pos = start
                        val end = start + len
                        while (pos < end) {
                            if (isStopped) throw IOException("stopped")
                            buf.clear()
                            buf.limit(minOf(buf.capacity().toLong(), end - pos).toInt())
                            val n = ch.read(buf, pos)
                            if (n <= 0) throw IOException("Unexpected end of file")
                            sink.write(buf.array(), 0, n)
                            pos += n
                            counted += n
                            sent.addAndGet(n.toLong())
                            report("uploading")
                        }
                    }
                }
            }
        }
        val req = Request.Builder().url(api.url(url)).put(body).build()
        try {
            Api.client.newCall(req).execute().use { res ->
                if (!res.isSuccessful) {
                    // 403 usually means the presigned URL expired — retriable (a fresh URL is requested).
                    throw ApiException(if (res.code == 403) 503 else res.code, "CHUNK_FAILED", "Chunk upload failed (HTTP ${res.code})")
                }
            }
        } catch (e: Exception) {
            sent.addAndGet(-counted)
            counted = 0
            throw e
        }
    }

    private fun report(state: String, force: Boolean = false) {
        val now = System.currentTimeMillis()
        if (!force && now - lastReport < 700) return
        lastReport = now
        val bytes = sent.get().coerceIn(0, size)
        if (lastTime > 0 && now > lastTime) {
            val inst = (bytes - lastBytes) * 1000.0 / (now - lastTime)
            speed = if (speed == 0.0) inst else speed * 0.6 + inst * 0.4
        }
        lastBytes = bytes
        lastTime = now
        setProgressAsync(
            workDataOf(K_STATE to state, K_BYTES to bytes, K_TOTAL to size, K_SPEED to speed.toLong().coerceAtLeast(0), K_UPLOAD_ID to uploadId),
        )
        runCatching { setForegroundAsync(foreground(bytes, size)) }
    }

    private fun foreground(bytes: Long, total: Long): ForegroundInfo {
        val n = Notifier.progress(applicationContext, name, bytes, total, id)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(notifId, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else ForegroundInfo(notifId, n)
    }

    private fun retryLater(msg: String?): Result {
        setProgressAsync(workDataOf(K_STATE to "waiting", K_BYTES to sent.get(), K_TOTAL to size, K_ERROR to msg))
        return Result.retry()
    }

    private fun fail(code: String, message: String): Result {
        Notifier.done(applicationContext, notifId, name, false, message)
        return Result.failure(workDataOf(K_STATE to "failed", K_ERROR_CODE to code, K_ERROR to message, K_BYTES to sent.get(), K_TOTAL to size))
    }

    companion object {
        const val TAG = "vv-upload"
        const val K_URI = "uri"
        const val K_NAME = "name"
        const val K_SIZE = "size"
        const val K_MIME = "mime"
        const val K_FOLDER = "folderId"
        const val K_ALLOW_DUP = "allowDuplicate"
        const val K_STATE = "state"
        const val K_BYTES = "bytes"
        const val K_TOTAL = "total"
        const val K_SPEED = "speed"
        const val K_ERROR = "error"
        const val K_ERROR_CODE = "errorCode"
        const val K_UPLOAD_ID = "uploadId"
        const val K_VIDEO_ID = "videoId"
        private const val MAX_ATTEMPTS = 20

        fun enqueue(context: Context, v: PickedVideo, folderId: String?, allowDuplicate: Boolean = false) {
            val prefs = Prefs(context)
            val data = Data.Builder()
                .putString(K_URI, v.uri.toString())
                .putString(K_NAME, v.name)
                .putLong(K_SIZE, v.size)
                .putString(K_MIME, v.mime)
                .putString(K_FOLDER, folderId)
                .putBoolean(K_ALLOW_DUP, allowDuplicate)
                .build()
            val req = OneTimeWorkRequestBuilder<UploadWorker>()
                .setInputData(data)
                .addTag(TAG)
                // WorkInfo doesn't expose input data, so the UI reads what it needs (and what Retry needs) from tags.
                .addTag("name:${v.name}")
                .addTag("uri:${v.uri}")
                .addTag("size:${v.size}")
                .addTag("mime:${v.mime ?: ""}")
                .addTag("folder:${folderId ?: ""}")
                .addTag("t:${System.currentTimeMillis()}")
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(if (prefs.wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED)
                        .build(),
                )
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .build()
            // One job per file: picking a video that is already uploading is a no-op; finished/failed jobs are re-run.
            WorkManager.getInstance(context).enqueueUniqueWork("upload:${v.uri}", ExistingWorkPolicy.KEEP, req)
        }

        fun openAppIntent(context: Context): PendingIntent = PendingIntent.getActivity(
            context, 0, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }
}

object Notifier {
    const val CHANNEL_PROGRESS = "uploads"
    const val CHANNEL_RESULT = "upload-results"

    fun progress(context: Context, name: String, bytes: Long, total: Long, workId: java.util.UUID) =
        NotificationCompat.Builder(context, CHANNEL_PROGRESS)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle(context.getString(R.string.notif_uploading, name))
            .setContentText(if (total > 0) "${Format.bytes(bytes)} / ${Format.bytes(total)}" else context.getString(R.string.state_preparing))
            .setProgress(100, if (total > 0) ((bytes * 100) / total).toInt() else 0, total <= 0 || bytes <= 0)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setContentIntent(UploadWorker.openAppIntent(context))
            .addAction(
                android.R.drawable.ic_menu_close_clear_cancel,
                context.getString(R.string.cancel),
                WorkManager.getInstance(context).createCancelPendingIntent(workId),
            )
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()

    fun done(context: Context, id: Int, name: String, ok: Boolean, error: String?) {
        val nm = context.getSystemService(android.app.NotificationManager::class.java)
        val n = NotificationCompat.Builder(context, CHANNEL_RESULT)
            .setSmallIcon(if (ok) android.R.drawable.stat_sys_upload_done else android.R.drawable.stat_notify_error)
            .setContentTitle(context.getString(if (ok) R.string.notif_done else R.string.notif_failed, name))
            .setContentText(error)
            .setAutoCancel(true)
            .setContentIntent(UploadWorker.openAppIntent(context))
            .build()
        runCatching { nm.notify(id + 1, n) }
    }
}
