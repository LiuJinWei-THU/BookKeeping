package com.liujinwei.ledger

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.File
import java.io.FileOutputStream

/** 监听服务与前台页面之间的进程内通信（同一进程，无需 Binder/广播） */
object Hub {
    @Volatile
    var main: MainActivity? = null

    /** 后台记账成功后推送给网页（页面不在前台时静默，下次加载会从 pending 合并） */
    fun notifyAutoBill(bill: Bill) {
        val act = main ?: return
        act.runOnUiThread {
            val payload = bill.toJson().put("ok", true)
            act.evalJs("window.__onAutoBill && window.__onAutoBill($payload)")
        }
    }
}

/**
 * 单 Activity + WebView 架构：界面就是仓库根目录那份记账网页（构建时复制进 assets），
 * 通过 addJavascriptInterface 注入 AndroidStore 桥，数据读写全部走本地 SQLite。
 */
class MainActivity : Activity() {

    lateinit var web: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        setContentView(web)
        Hub.main = this

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true   // 网页的设置项（ledger_settings_v1）存在 WebView localStorage
            databaseEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            // 页面与数据全部随 APK 自带；开放跨源仅为允许 file:// 页面访问 CDN（ECharts 兜底 / Tesseract 模型 / AI 接口）
            @Suppress("DEPRECATION")
            allowUniversalAccessFromFileURLs = true
            @Suppress("DEPRECATION")
            allowFileAccessFromFileURLs = true
            useWideViewPort = true
            loadWithOverviewMode = true
        }
        web.addJavascriptInterface(JsBridge(this), "AndroidStore")

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // 页面本身是 file://，任何 http(s) 导航（如设置页教程链接）交给系统浏览器
                val u = request.url
                if (u.scheme == "http" || u.scheme == "https") {
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, u))
                    } catch (_: ActivityNotFoundException) {
                    }
                    return true
                }
                return false
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                v: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    startActivityForResult(params.createIntent(), REQ_FILE)
                    true
                } catch (_: ActivityNotFoundException) {
                    fileCallback = null
                    false
                }
            }
        }

        web.loadUrl("file:///android_asset/web/index.html")
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == REQ_FILE) {
            val cb = fileCallback ?: return
            fileCallback = null
            cb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    override fun onResume() {
        super.onResume()
        // 从系统授权页返回后刷新页面状态（通知使用权状态、待合并账单）
        evalJs("window.__onResume && window.__onResume()")
    }

    override fun onDestroy() {
        if (Hub.main === this) Hub.main = null
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // 退到后台而不是销毁：保持通知监听常驻、页面状态不丢
        moveTaskToBack(true)
    }

    fun evalJs(script: String) {
        web.evaluateJavascript(script, null)
    }

    /** 导出备份到手机"下载"目录，返回展示给用户的路径 */
    fun writeBackupToDownloads(name: String, content: String): String {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                put(MediaStore.MediaColumns.MIME_TYPE, "application/json")
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: throw IllegalStateException("无法在下载目录创建文件")
            val os = contentResolver.openOutputStream(uri)
                ?: throw IllegalStateException("文件打开失败")
            os.use { it.write(content.toByteArray(Charsets.UTF_8)) }
            values.clear()
            values.put(MediaStore.MediaColumns.IS_PENDING, 0)
            contentResolver.update(uri, values, null, null)
            return "下载/$name"
        }
        // Android 9 及以下：公共下载目录需要存储权限（仅导出时申请）
        if (checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            runOnUiThread {
                requestPermissions(arrayOf(android.Manifest.permission.WRITE_EXTERNAL_STORAGE), REQ_WRITE)
            }
            throw IllegalStateException("已请求存储权限，请允许后再次点击导出")
        }
        val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        if (!dir.exists()) dir.mkdirs()
        FileOutputStream(File(dir, name)).use { it.write(content.toByteArray(Charsets.UTF_8)) }
        return "下载/$name"
    }

    companion object {
        private const val REQ_FILE = 1001
        private const val REQ_WRITE = 1002
    }
}
