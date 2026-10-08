package app.vidvault.android

import android.content.Context
import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Error returned by the VidVault API: `{ "error": { "code", "message", "details" } }`. */
class ApiException(val status: Int, val code: String, message: String, val details: JSONObject? = null) : IOException(message) {
    /** Network problems, timeouts, rate limits and server errors are worth retrying. */
    val retriable get() = status == 0 || status == 408 || status == 429 || status >= 500
}

/** Saved sign-in and preferences (app-private storage). */
class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("vidvault", Context.MODE_PRIVATE)
    var server: String
        get() = sp.getString("server", BuildConfig.DEFAULT_SERVER)!!
        set(v) = sp.edit().putString("server", v.trimEnd('/')).apply()
    var token: String?
        get() = sp.getString("token", null)
        set(v) = sp.edit().putString("token", v).apply()
    var userName: String?
        get() = sp.getString("userName", null)
        set(v) = sp.edit().putString("userName", v).apply()
    var userEmail: String?
        get() = sp.getString("userEmail", null)
        set(v) = sp.edit().putString("userEmail", v).apply()
    var wifiOnly: Boolean
        get() = sp.getBoolean("wifiOnly", false)
        set(v) = sp.edit().putBoolean("wifiOnly", v).apply()
    var parallelChunks: Int
        get() = sp.getInt("parallelChunks", 3)
        set(v) = sp.edit().putInt("parallelChunks", v.coerceIn(1, 6)).apply()
    var lastFolderId: String?
        get() = sp.getString("lastFolderId", null)
        set(v) = sp.edit().putString("lastFolderId", v).apply()

    fun signOut() = sp.edit().remove("token").remove("userName").remove("userEmail").apply()
}

class Api(private val context: Context) {
    val prefs = Prefs(context)

    /** Absolute URL for API paths and for relative presigned URLs (local storage driver). */
    fun url(path: String) = if (path.startsWith("http")) path else prefs.server + path

    private fun request(path: String): Request.Builder {
        val b = Request.Builder().url(url(path)).header("User-Agent", "VidVault-Android/${BuildConfig.VERSION_NAME}")
        prefs.token?.let { b.header("Authorization", "Bearer $it") }
        return b
    }

    suspend fun get(path: String): JSONObject = call(request(path).get().build())
    suspend fun post(path: String, body: JSONObject = JSONObject()): JSONObject = call(request(path).post(body.toBody()).build())
    suspend fun delete(path: String): JSONObject = call(request(path).delete().build())

    private fun JSONObject.toBody(): RequestBody = toString().toRequestBody(JSON)

    private suspend fun call(req: Request): JSONObject = withContext(Dispatchers.IO) {
        val res = try {
            client.newCall(req).execute()
        } catch (e: IOException) {
            throw ApiException(0, "NETWORK", context.getString(R.string.err_network))
        }
        res.use {
            val text = it.body?.string().orEmpty()
            val json = runCatching { JSONObject(text) }.getOrNull() ?: JSONObject()
            if (!it.isSuccessful) {
                val err = json.optJSONObject("error")
                throw ApiException(
                    it.code,
                    err?.optString("code")?.takeIf { c -> c.isNotEmpty() } ?: "HTTP_${it.code}",
                    err?.optString("message")?.takeIf { m -> m.isNotEmpty() } ?: context.getString(R.string.err_server, it.code),
                    err?.optJSONObject("details"),
                )
            }
            json
        }
    }

    // ---------- Endpoints ----------

    suspend fun signIn(server: String, email: String, password: String): JSONObject {
        prefs.server = server
        prefs.token = null
        val body = JSONObject()
            .put("email", email)
            .put("password", password)
            .put("deviceName", "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}".take(100))
        val r = post("/api/auth/token", body)
        prefs.token = r.getString("token")
        r.getJSONObject("user").let {
            prefs.userName = it.optString("name")
            prefs.userEmail = it.optString("email")
        }
        return r
    }

    suspend fun signOut() {
        runCatching { post("/api/auth/logout") }
        prefs.signOut()
    }

    suspend fun folders(): List<Pair<String, String>> {
        val arr = get("/api/folders").getJSONArray("folders")
        val all = (0 until arr.length()).map { arr.getJSONObject(it) }
        val byId = all.associateBy { it.getString("id") }
        fun path(f: JSONObject): String {
            val parts = mutableListOf(f.getString("name"))
            var p = f.optString("parentId").takeIf { it.isNotEmpty() && it != "null" }
            var guard = 0
            while (p != null && guard++ < 20) {
                val parent = byId[p] ?: break
                parts.add(0, parent.getString("name"))
                p = parent.optString("parentId").takeIf { it.isNotEmpty() && it != "null" }
            }
            return parts.joinToString(" / ")
        }
        return all.map { it.getString("id") to path(it) }.sortedBy { it.second.lowercase() }
    }

    suspend fun stats(): JSONObject = get("/api/me/stats")

    companion object {
        val JSON = "application/json; charset=utf-8".toMediaType()

        /** Shared client; long timeouts because chunks can be tens of MB on slow mobile links. */
        val client: OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(5, TimeUnit.MINUTES)
            .writeTimeout(15, TimeUnit.MINUTES)
            .retryOnConnectionFailure(true)
            .build()

        fun ints(arr: JSONArray?): List<Int> = if (arr == null) emptyList() else (0 until arr.length()).map { arr.getInt(it) }
    }
}
