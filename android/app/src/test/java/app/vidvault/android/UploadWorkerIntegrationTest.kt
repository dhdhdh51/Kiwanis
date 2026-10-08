package app.vidvault.android

import android.content.Context
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.workDataOf
import kotlinx.coroutines.runBlocking
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.io.RandomAccessFile
import kotlin.random.Random

/**
 * Runs the real UploadWorker against a live VidVault server.
 *   VV_TEST_SERVER=http://localhost:4000 VV_TEST_EMAIL=… VV_TEST_PASSWORD=… ./gradlew testDebugUnitTest
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class UploadWorkerIntegrationTest {
    private val server = System.getenv("VV_TEST_SERVER")
    private lateinit var ctx: Context
    private lateinit var api: Api

    @Before
    fun setUp() {
        assumeTrue("VV_TEST_SERVER not set", server != null)
        ctx = ApplicationProvider.getApplicationContext()
        api = Api(ctx)
        runBlocking { api.signIn(server!!, System.getenv("VV_TEST_EMAIL")!!, System.getenv("VV_TEST_PASSWORD")!!) }
    }

    /** A fake MP4 (valid "ftyp" header) with random content so every test file is unique. */
    private fun videoFile(name: String, mb: Int): File {
        val f = File.createTempFile("vvtest", "-$name")
        RandomAccessFile(f, "rw").use { raf ->
            val chunk = ByteArray(1024 * 1024)
            repeat(mb) {
                Random.nextBytes(chunk)
                if (it == 0) {
                    byteArrayOf(0, 0, 0, 32).copyInto(chunk, 0)
                    "ftypisom".toByteArray().copyInto(chunk, 4)
                }
                raf.write(chunk)
            }
        }
        return f
    }

    private fun worker(f: File, name: String, allowDuplicate: Boolean = false) =
        TestListenableWorkerBuilder<UploadWorker>(ctx)
            .setInputData(
                workDataOf(
                    UploadWorker.K_URI to Uri.fromFile(f).toString(),
                    UploadWorker.K_NAME to name,
                    UploadWorker.K_SIZE to f.length(),
                    UploadWorker.K_MIME to "video/mp4",
                    UploadWorker.K_ALLOW_DUP to allowDuplicate,
                ),
            )
            .build()

    @Test
    fun uploadsMultiChunkVideo_thenDetectsDuplicate() = runBlocking {
        val f = videoFile("big.mp4", 40) // 3 chunks of 16 MB
        val name = "android-${System.currentTimeMillis()}.mp4"
        val result = worker(f, name).doWork()
        assertTrue("expected success, got $result", result is ListenableWorker.Result.Success)
        val videoId = result.outputData.getString(UploadWorker.K_VIDEO_ID)!!
        val v = api.get("/api/videos/$videoId").getJSONObject("video")
        assertEquals(name, v.getString("filename"))
        assertEquals(f.length(), v.getLong("size"))
        println("UPLOAD OK: $name ${v.getLong("size")} bytes, status=${v.getString("status")}")

        val dup = worker(f, name).doWork()
        assertTrue(dup is ListenableWorker.Result.Failure)
        assertEquals("DUPLICATE", dup.outputData.getString(UploadWorker.K_ERROR_CODE))
        println("DUPLICATE OK: ${dup.outputData.getString(UploadWorker.K_ERROR)}")
    }

    @Test
    fun resumesInterruptedUpload() = runBlocking {
        val f = videoFile("resume.mp4", 36)
        val name = "resume-${System.currentTimeMillis()}.mp4"
        val fp = VideoFiles.fingerprint(ctx.contentResolver, Uri.fromFile(f), f.length())

        // Simulate an upload that was interrupted after the first chunk.
        val s = api.post("/api/uploads", JSONObject().put("filename", name).put("size", f.length()).put("fingerprint", fp).put("mimeType", "video/mp4"))
        val chunk = s.getLong("chunkSize").toInt()
        val part = api.post("/api/uploads/${s.getString("uploadId")}/parts", JSONObject().put("partNumbers", JSONArray(listOf(1))))
            .getJSONArray("parts").getJSONObject(0).getString("url")
        val bytes = f.readBytes().copyOf(chunk)
        Api.client.newCall(Request.Builder().url(api.url(part)).put(bytes.toRequestBody()).build()).execute().use { assertTrue(it.isSuccessful) }

        val result = worker(f, name).doWork()
        assertTrue("expected success, got $result", result is ListenableWorker.Result.Success)
        assertEquals("worker must resume the same upload", s.getString("videoId"), result.outputData.getString(UploadWorker.K_VIDEO_ID))
        val v = api.get("/api/videos/${s.getString("videoId")}").getJSONObject("video")
        assertEquals(f.length(), v.getLong("size"))
        println("RESUME OK: continued upload ${s.getString("uploadId")} after chunk 1")
    }

    @Test
    fun rejectsInvalidContent() = runBlocking {
        val f = File.createTempFile("vvtest", "-bad.mkv").apply { writeBytes(Random.nextBytes(64 * 1024)) }
        val result = worker(f, "bad-${System.currentTimeMillis()}.mkv").doWork()
        assertTrue(result is ListenableWorker.Result.Failure)
        assertEquals("INVALID_FILE", result.outputData.getString(UploadWorker.K_ERROR_CODE))
        println("INVALID OK: ${result.outputData.getString(UploadWorker.K_ERROR)}")
    }
}
