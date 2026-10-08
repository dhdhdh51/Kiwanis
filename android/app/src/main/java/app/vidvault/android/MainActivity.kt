package app.vidvault.android

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.LayoutInflater
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import androidx.work.WorkInfo
import androidx.work.WorkManager
import app.vidvault.android.databinding.ActivityMainBinding
import app.vidvault.android.databinding.ItemUploadBinding
import com.google.android.material.snackbar.Snackbar
import kotlinx.coroutines.launch
import java.util.UUID

/** One row in the upload list, derived from a WorkManager job. */
data class UploadRow(
    val id: UUID,
    val name: String,
    val uri: Uri?,
    val size: Long,
    val mime: String?,
    val folderId: String?,
    val addedAt: Long,
    val state: WorkInfo.State,
    val phase: String?,
    val bytes: Long,
    val speed: Long,
    val error: String?,
    val errorCode: String?,
    val uploadId: String?,
    val attempts: Int,
) {
    val percent get() = if (state == WorkInfo.State.SUCCEEDED) 100 else if (size > 0) ((bytes * 100) / size).toInt().coerceIn(0, 100) else 0
    val active get() = state == WorkInfo.State.RUNNING || state == WorkInfo.State.ENQUEUED || state == WorkInfo.State.BLOCKED

    companion object {
        fun from(w: WorkInfo): UploadRow {
            fun tag(p: String) = w.tags.firstOrNull { it.startsWith("$p:") }?.substringAfter(':')
            val data = if (w.state.isFinished) w.outputData else w.progress
            return UploadRow(
                id = w.id,
                name = tag("name") ?: "video",
                uri = tag("uri")?.let(Uri::parse),
                size = tag("size")?.toLongOrNull() ?: data.getLong(UploadWorker.K_TOTAL, 0),
                mime = tag("mime")?.ifEmpty { null },
                folderId = tag("folder")?.ifEmpty { null },
                addedAt = tag("t")?.toLongOrNull() ?: 0,
                state = w.state,
                phase = data.getString(UploadWorker.K_STATE),
                bytes = data.getLong(UploadWorker.K_BYTES, 0),
                speed = data.getLong(UploadWorker.K_SPEED, 0),
                error = data.getString(UploadWorker.K_ERROR),
                errorCode = data.getString(UploadWorker.K_ERROR_CODE),
                uploadId = data.getString(UploadWorker.K_UPLOAD_ID),
                attempts = w.runAttemptCount,
            )
        }
    }
}

class MainActivity : AppCompatActivity() {
    private lateinit var b: ActivityMainBinding
    private val api by lazy { Api(this) }
    private val wm by lazy { WorkManager.getInstance(this) }
    private var folders: List<Pair<String?, String>> = listOf(null to "My Videos")
    private var maxFileSize = Long.MAX_VALUE
    private val adapter = UploadAdapter(::onRowAction)

    private val picker = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris -> if (uris.isNotEmpty()) addVideos(uris, persist = true) }
    private val notifPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (api.prefs.token == null) {
            startActivity(Intent(this, LoginActivity::class.java).also { it.putExtras(intent) })
            finish()
            return
        }
        b = ActivityMainBinding.inflate(layoutInflater)
        setContentView(b.root)
        setSupportActionBar(b.toolbar)
        supportActionBar?.subtitle = api.prefs.userEmail

        b.list.layoutManager = LinearLayoutManager(this)
        b.list.adapter = adapter
        b.pick.setOnClickListener { picker.launch(arrayOf("video/*")) }
        b.retryFailed.setOnClickListener { adapter.currentList.filter { it.state == WorkInfo.State.FAILED && it.errorCode != "DUPLICATE" }.forEach(::retry) }

        wm.getWorkInfosByTagLiveData(UploadWorker.TAG).observe(this) { infos ->
            val rows = infos.map(UploadRow::from).sortedByDescending { it.addedAt }
            adapter.submitList(rows)
            renderSummary(rows)
        }

        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        loadAccount()
        handleShare(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleShare(intent)
    }

    /** Videos shared from the gallery / other apps. */
    private fun handleShare(intent: Intent?) {
        val uris = when (intent?.action) {
            Intent.ACTION_SEND -> listOfNotNull(IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java))
            Intent.ACTION_SEND_MULTIPLE -> IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java).orEmpty()
            else -> emptyList()
        }
        if (uris.isNotEmpty()) {
            intent?.action = null
            addVideos(uris, persist = false)
        }
    }

    private fun loadAccount() = lifecycleScope.launch {
        try {
            val cfg = api.get("/api/config")
            maxFileSize = cfg.optLong("maxFileSize", Long.MAX_VALUE)
            val stats = api.stats()
            val used = stats.getLong("storageUsed")
            val limit = stats.getLong("storageLimit")
            b.storageText.text = getString(R.string.storage_used, Format.bytes(used), Format.bytes(limit))
            b.storageBar.progress = if (limit > 0) ((used * 100) / limit).toInt() else 0
            folders = listOf<Pair<String?, String>>(null to getString(R.string.no_folder)) + api.folders()
            val names = folders.map { it.second }
            b.folder.setAdapter(ArrayAdapter(this@MainActivity, android.R.layout.simple_list_item_1, names))
            val idx = folders.indexOfFirst { it.first == api.prefs.lastFolderId }.coerceAtLeast(0)
            b.folder.setText(names[idx], false)
            b.folder.setOnItemClickListener { _, _, pos, _ -> api.prefs.lastFolderId = folders[pos].first }
        } catch (e: ApiException) {
            if (e.status == 401) signedOut() else b.storageText.text = e.message
        }
    }

    private fun selectedFolder(): String? = folders.firstOrNull { it.second == b.folder.text.toString() }?.first

    private fun addVideos(uris: List<Uri>, persist: Boolean) {
        val folderId = selectedFolder()
        var added = 0
        val problems = mutableListOf<String>()
        for (uri in uris) {
            if (persist) runCatching { contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) }
            val v = VideoFiles.describe(this, uri)
            when {
                v == null -> problems += getString(R.string.err_unreadable)
                VideoFiles.ext(v.name) !in VideoFiles.SUPPORTED -> problems += getString(R.string.err_format, v.name)
                v.size > maxFileSize -> problems += getString(R.string.err_too_large, v.name, Format.bytes(maxFileSize))
                else -> {
                    UploadWorker.enqueue(this, v, folderId)
                    added++
                }
            }
        }
        if (problems.isNotEmpty()) {
            AlertDialog.Builder(this)
                .setTitle(getString(R.string.skipped_title, problems.size))
                .setMessage(problems.joinToString("\n• ", prefix = "• "))
                .setPositiveButton(android.R.string.ok, null)
                .show()
        }
        if (added > 0) Snackbar.make(b.root, resources.getQuantityString(R.plurals.queued, added, added), Snackbar.LENGTH_LONG).show()
    }

    private fun renderSummary(rows: List<UploadRow>) {
        val relevant = rows.filter { it.state != WorkInfo.State.CANCELLED }
        val done = relevant.count { it.state == WorkInfo.State.SUCCEEDED }
        val failed = relevant.count { it.state == WorkInfo.State.FAILED }
        val running = relevant.any { it.active }
        val total = relevant.sumOf { it.size }
        val sent = relevant.sumOf { if (it.state == WorkInfo.State.SUCCEEDED) it.size else it.bytes }
        val speed = relevant.filter { it.state == WorkInfo.State.RUNNING }.sumOf { it.speed }
        b.empty.visibility = if (rows.isEmpty()) View.VISIBLE else View.GONE
        b.summaryCard.visibility = if (relevant.isEmpty()) View.GONE else View.VISIBLE
        val pct = if (total > 0) ((sent * 100) / total).toInt() else 0
        b.summaryTitle.text = if (running) getString(R.string.summary_running, relevant.size, pct) else getString(R.string.summary_done, done, relevant.size)
        val parts = mutableListOf(getString(R.string.summary_count, done, relevant.size))
        if (running && speed > 0) {
            parts += Format.speed(speed)
            Format.eta((total - sent) / speed).takeIf { it.isNotEmpty() }?.let { parts += getString(R.string.eta, it) }
        }
        if (failed > 0) parts += getString(R.string.summary_failed, failed)
        b.summaryText.text = parts.joinToString(" · ")
        b.summaryBar.progress = pct
        b.retryFailed.visibility = if (failed > 0) View.VISIBLE else View.GONE
    }

    private fun onRowAction(row: UploadRow, action: String) {
        when (action) {
            "cancel" -> {
                wm.cancelWorkById(row.id)
                row.uploadId?.let { id -> lifecycleScope.launch { runCatching { api.delete("/api/uploads/$id") } } }
            }
            "retry" -> retry(row)
            "duplicate" -> retry(row, allowDuplicate = true)
        }
    }

    private fun retry(row: UploadRow, allowDuplicate: Boolean = false) {
        val uri = row.uri ?: return
        UploadWorker.enqueue(this, PickedVideo(uri, row.name, row.size, row.mime), row.folderId, allowDuplicate)
    }

    private fun signedOut() {
        api.prefs.signOut()
        startActivity(Intent(this, LoginActivity::class.java))
        finish()
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.main, menu)
        menu.findItem(R.id.wifi_only).isChecked = api.prefs.wifiOnly
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        when (item.itemId) {
            R.id.wifi_only -> {
                api.prefs.wifiOnly = !item.isChecked
                item.isChecked = api.prefs.wifiOnly
                Snackbar.make(b.root, if (item.isChecked) R.string.wifi_only_on else R.string.wifi_only_off, Snackbar.LENGTH_SHORT).show()
            }
            R.id.clear -> wm.pruneWork()
            R.id.open_web -> startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(api.prefs.server + "/videos")))
            R.id.sign_out -> AlertDialog.Builder(this)
                .setTitle(R.string.sign_out)
                .setMessage(R.string.sign_out_confirm)
                .setPositiveButton(R.string.sign_out) { _, _ ->
                    wm.cancelAllWorkByTag(UploadWorker.TAG)
                    lifecycleScope.launch {
                        api.signOut()
                        wm.pruneWork()
                        signedOut()
                    }
                }
                .setNegativeButton(android.R.string.cancel, null)
                .show()
            else -> return super.onOptionsItemSelected(item)
        }
        return true
    }
}

class UploadAdapter(private val onAction: (UploadRow, String) -> Unit) : ListAdapter<UploadRow, UploadAdapter.VH>(DIFF) {
    class VH(val b: ItemUploadBinding) : RecyclerView.ViewHolder(b.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = VH(ItemUploadBinding.inflate(LayoutInflater.from(parent.context), parent, false))

    override fun onBindViewHolder(h: VH, position: Int) {
        val r = getItem(position)
        val ctx = h.b.root.context
        h.b.name.text = r.name
        h.b.size.text = Format.bytes(r.size)
        val (status, color) = when (r.state) {
            WorkInfo.State.SUCCEEDED -> ctx.getString(R.string.state_completed) to R.color.ok
            WorkInfo.State.FAILED -> (if (r.errorCode == "DUPLICATE") r.error.orEmpty() else ctx.getString(R.string.state_failed, r.error.orEmpty())) to
                if (r.errorCode == "DUPLICATE") R.color.warn else R.color.bad
            WorkInfo.State.CANCELLED -> ctx.getString(R.string.state_cancelled) to R.color.muted
            WorkInfo.State.RUNNING -> when (r.phase) {
                "preparing", null -> ctx.getString(R.string.state_preparing)
                "finalizing" -> ctx.getString(R.string.state_finalizing)
                else -> ctx.getString(R.string.state_uploading, r.percent, Format.speed(r.speed))
            } to R.color.brand
            else -> (if (r.attempts > 0 || r.bytes > 0) ctx.getString(R.string.state_waiting_network, r.percent) else ctx.getString(R.string.state_queued)) to R.color.muted
        }
        h.b.status.text = status
        h.b.status.setTextColor(ContextCompat.getColor(ctx, color))
        h.b.progress.visibility = if (r.active) View.VISIBLE else View.GONE
        h.b.progress.isIndeterminate = r.state == WorkInfo.State.RUNNING && (r.phase == "preparing" || r.phase == "finalizing" || r.phase == null)
        h.b.progress.setProgressCompat(r.percent, true)
        h.b.icon.setImageResource(
            when (r.state) {
                WorkInfo.State.SUCCEEDED -> R.drawable.ic_check
                WorkInfo.State.FAILED -> R.drawable.ic_error
                else -> R.drawable.ic_video
            },
        )
        h.b.action.visibility = View.VISIBLE
        when {
            r.active -> {
                h.b.action.setText(R.string.cancel)
                h.b.action.setOnClickListener { onAction(r, "cancel") }
            }
            r.state == WorkInfo.State.FAILED && r.errorCode == "DUPLICATE" -> {
                h.b.action.setText(R.string.upload_anyway)
                h.b.action.setOnClickListener { onAction(r, "duplicate") }
            }
            (r.state == WorkInfo.State.FAILED && r.errorCode !in PERMANENT) || r.state == WorkInfo.State.CANCELLED -> {
                h.b.action.setText(R.string.retry)
                h.b.action.setOnClickListener { onAction(r, "retry") }
            }
            else -> h.b.action.visibility = View.GONE
        }
    }

    companion object {
        private val PERMANENT = setOf("UNSUPPORTED_FORMAT", "FILE_TOO_LARGE", "INVALID_FILE", "NO_ACCESS")
        private val DIFF = object : DiffUtil.ItemCallback<UploadRow>() {
            override fun areItemsTheSame(a: UploadRow, b: UploadRow) = a.id == b.id
            override fun areContentsTheSame(a: UploadRow, b: UploadRow) = a == b
        }
    }
}
