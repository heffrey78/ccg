package dev.ccg.engine

import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

// Copied over the generated activity by build.sh. A game takes the whole screen (#172): the system
// bars hide until swiped in, and the page draws behind any camera cutout, so its theme reaches every
// edge. The page keeps its controls clear with the insets given here: the webview doesn't report them
// reliably. It's also told when the app goes to the background and returns (#163): Android's webview
// goes on reporting the page as visible, and audio goes on playing.
class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  @Volatile private var safeArea = "{}"

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      window.attributes.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      window.attributes.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
    }
    hideSystemBars()
    ViewCompat.setOnApplyWindowInsetsListener(findViewById<View>(android.R.id.content)) { _, insets ->
      val area = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val density = resources.displayMetrics.density
      safeArea = """{"top":${area.top / density},"right":${area.right / density},"bottom":${area.bottom / density},"left":${area.left / density}}"""
      webView?.evaluateJavascript("window.dispatchEvent(new Event('ccg-insets'))", null)
      WindowInsetsCompat.CONSUMED
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    webView.addJavascriptInterface(object {
      @JavascriptInterface
      fun safeArea(): String = this@MainActivity.safeArea
    }, "ccgShell")
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) hideSystemBars()
  }

  override fun onPause() {
    super.onPause()
    webView?.evaluateJavascript("window.dispatchEvent(new Event('ccg-background'))", null)
  }

  override fun onResume() {
    super.onResume()
    webView?.evaluateJavascript("window.dispatchEvent(new Event('ccg-foreground'))", null)
  }

  private fun hideSystemBars() {
    WindowCompat.getInsetsController(window, window.decorView).apply {
      systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      hide(WindowInsetsCompat.Type.systemBars())
    }
  }
}
