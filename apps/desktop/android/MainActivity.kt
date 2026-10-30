package dev.ccg.engine

import android.os.Bundle
import android.view.View
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

// Copied over the generated activity by build.sh (#162). The app draws edge to edge, so the page is
// kept clear of the status and navigation bars and any camera cutout here: the webview doesn't
// report them to the page reliably. It also tells the page when the app goes to the background and
// returns (#163): Android's webview goes on reporting the page as visible, and audio goes on playing.
class MainActivity : TauriActivity() {
  private var webView: WebView? = null

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
  }

  override fun onPause() {
    super.onPause()
    webView?.evaluateJavascript("window.dispatchEvent(new Event('ccg-background'))", null)
  }

  override fun onResume() {
    super.onResume()
    webView?.evaluateJavascript("window.dispatchEvent(new Event('ccg-foreground'))", null)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    ViewCompat.setOnApplyWindowInsetsListener(findViewById<View>(android.R.id.content)) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
  }
}
