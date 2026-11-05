package com.dkahn.rouge_retrouve

import android.content.ContentValues
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.view.WindowManager
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File
import kotlin.concurrent.thread

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "rouge_retrouve/device")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "keepAwake" -> {
                        if (call.argument<Boolean>("on") == true) {
                            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                        } else {
                            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                        }
                        result.success(null)
                    }
                    "saveToGallery" -> saveToGallery(
                        call.argument<String>("path")!!,
                        call.argument<String>("name")!!,
                        result,
                    )
                    else -> result.notImplemented()
                }
            }
    }

    /** Copie la vidéo dans Films/Rouge Retrouvé, hors du thread principal (fichiers volumineux). */
    private fun saveToGallery(path: String, name: String, result: MethodChannel.Result) {
        val main = Handler(Looper.getMainLooper())
        thread {
            val resolver = contentResolver
            val values = ContentValues().apply {
                put(MediaStore.Video.Media.DISPLAY_NAME, name)
                put(MediaStore.Video.Media.MIME_TYPE, if (name.endsWith(".webm")) "video/webm" else "video/mp4")
                put(MediaStore.Video.Media.RELATIVE_PATH, "Movies/Rouge Retrouvé")
                put(MediaStore.Video.Media.IS_PENDING, 1)
            }
            val collection = MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            var uri: android.net.Uri? = null
            try {
                uri = resolver.insert(collection, values) ?: error("Galerie indisponible")
                resolver.openOutputStream(uri)!!.use { out ->
                    File(path).inputStream().use { it.copyTo(out, 1 shl 20) }
                }
                values.clear()
                values.put(MediaStore.Video.Media.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
                main.post { result.success(null) }
            } catch (e: Exception) {
                uri?.let { resolver.delete(it, null, null) }
                main.post { result.error("save_failed", e.message, null) }
            }
        }
    }
}
