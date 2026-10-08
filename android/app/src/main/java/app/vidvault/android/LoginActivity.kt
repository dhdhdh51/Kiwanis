package app.vidvault.android

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.inputmethod.EditorInfo
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import app.vidvault.android.databinding.ActivityLoginBinding
import kotlinx.coroutines.launch

class LoginActivity : AppCompatActivity() {
    private lateinit var b: ActivityLoginBinding
    private val api by lazy { Api(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityLoginBinding.inflate(layoutInflater)
        setContentView(b.root)
        b.server.setText(api.prefs.server)
        b.email.setText(api.prefs.userEmail.orEmpty())
        b.password.setOnEditorActionListener { _, id, _ ->
            if (id == EditorInfo.IME_ACTION_DONE) signIn()
            id == EditorInfo.IME_ACTION_DONE
        }
        b.signIn.setOnClickListener { signIn() }
    }

    private fun signIn() {
        var server = b.server.text.toString().trim().trimEnd('/')
        if (!server.startsWith("http")) server = "https://$server"
        val email = b.email.text.toString().trim()
        val password = b.password.text.toString()
        if (email.isEmpty() || password.isEmpty()) {
            b.error.text = getString(R.string.err_fill_all)
            b.error.visibility = View.VISIBLE
            return
        }
        b.error.visibility = View.GONE
        b.signIn.isEnabled = false
        b.progress.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                api.signIn(server, email, password)
                startActivity(Intent(this@LoginActivity, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP))
                finish()
            } catch (e: Exception) {
                b.error.text = e.message ?: getString(R.string.err_network)
                b.error.visibility = View.VISIBLE
            } finally {
                b.signIn.isEnabled = true
                b.progress.visibility = View.GONE
            }
        }
    }
}
