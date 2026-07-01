package com.katkut.videoassembler

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix as GfxMatrix
import android.media.ExifInterface
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.net.Uri
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLExt
import android.opengl.EGLSurface
import android.opengl.GLES20
import android.opengl.GLUtils
import android.opengl.Matrix
import android.view.Surface
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer

/**
 * Renders a single still photo into a short H.264 MP4 (video-only, no audio) with Ken Burns motion
 * (slow zoom / pan) so it doesn't freeze the reel's momentum. Fully self-contained: its own EGL
 * context, a plain 2D-texture shader, and a hardware encoder + muxer — it does NOT reuse the shared
 * video GlRenderer/Transcoder, so it can't regress the video path.
 *
 * The produced clip is a normal MP4, so the rest of the pipeline (preview player, concat/export)
 * consumes it exactly like a video segment. Cover-fit to the 9:16 canvas (same as video today);
 * blurred-fill is a later shared enhancement.
 */
class PhotoClipEncoder(private val context: Context) {

  fun render(
    uri: String,
    outputPath: String,
    outW: Int,
    outH: Int,
    durationSec: Double,
    motionType: String,
    motionAmount: Double,
  ) {
    val bitmap = loadBitmap(uri, maxDim = maxOf(outW, outH) * 2)
    try {
      encode(bitmap, outputPath, outW, outH, durationSec, motionType, motionAmount)
    } finally {
      bitmap.recycle()
    }
  }

  private fun encode(
    bitmap: Bitmap,
    outputPath: String,
    outW: Int,
    outH: Int,
    durationSec: Double,
    motionType: String,
    motionAmount: Double,
  ) {
    val bitrate = if (maxOf(outW, outH) >= 1920) 10_000_000 else 5_000_000
    val format = MediaFormat.createVideoFormat(MIME, outW, outH).apply {
      setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
      setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
      setInteger(MediaFormat.KEY_FRAME_RATE, FPS)
      setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
    }

    val encoder = MediaCodec.createEncoderByType(MIME)
    encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    val inputSurface = encoder.createInputSurface()
    val gl = Egl(inputSurface)
    gl.setup()
    val texId = gl.uploadBitmap(bitmap)
    encoder.start()

    val muxer = MediaMuxer(outputPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    val mux = Mux(muxer)
    val info = MediaCodec.BufferInfo()

    // Cover-fit the source into the canvas (fill, no distortion; excess cropped) — same as video.
    val srcAspect = bitmap.width.toDouble() / bitmap.height.toDouble()
    val dstAspect = outW.toDouble() / outH.toDouble()
    var coverX = 1f
    var coverY = 1f
    if (srcAspect > dstAspect) coverX = (dstAspect / srcAspect).toFloat()
    else coverY = (srcAspect / dstAspect).toFloat()

    val totalFrames = maxOf(1, Math.round(durationSec * FPS).toInt())
    val frameDurUs = 1_000_000L / FPS
    val texMatrix = FloatArray(16)

    try {
      for (i in 0 until totalFrames) {
        val t = if (totalFrames <= 1) 0f else i.toFloat() / (totalFrames - 1)
        buildTexMatrix(texMatrix, coverX, coverY, motionType, motionAmount.toFloat(), t)
        gl.draw(texId, texMatrix, outW, outH)
        gl.setPresentationTime(i * frameDurUs * 1000)
        gl.swapBuffers()
        drainEncoder(encoder, mux, info, endOfStream = false)
      }
      encoder.signalEndOfInputStream()
      drainEncoder(encoder, mux, info, endOfStream = true)
    } finally {
      try { encoder.stop() } catch (_: Exception) {}
      try { encoder.release() } catch (_: Exception) {}
      gl.release()
      try { if (mux.started) muxer.stop() } catch (_: Exception) {}
      try { muxer.release() } catch (_: Exception) {}
    }
  }

  private class Mux(val muxer: MediaMuxer) {
    var started = false
    var videoTrack = -1
  }

  /** Pull encoder output into the muxer, starting the muxer on the first format-change. */
  private fun drainEncoder(encoder: MediaCodec, mux: Mux, info: MediaCodec.BufferInfo, endOfStream: Boolean) {
    val timeoutUs = if (endOfStream) 10_000L else 0L
    while (true) {
      val outIdx = encoder.dequeueOutputBuffer(info, timeoutUs)
      if (outIdx == MediaCodec.INFO_TRY_AGAIN_LATER) {
        if (!endOfStream) return // no more output right now
      } else if (outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
        if (mux.started) throw IllegalStateException("format changed twice")
        mux.videoTrack = mux.muxer.addTrack(encoder.outputFormat)
        mux.muxer.start()
        mux.started = true
      } else if (outIdx >= 0) {
        if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) info.size = 0
        if (info.size > 0 && mux.started) {
          val buf = encoder.getOutputBuffer(outIdx)!!
          buf.position(info.offset)
          buf.limit(info.offset + info.size)
          mux.muxer.writeSampleData(mux.videoTrack, buf, info)
        }
        encoder.releaseOutputBuffer(outIdx, false)
        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
      }
    }
  }

  /** Build the tex-coord transform: cover-fit scale + per-frame Ken Burns zoom/pan around center. */
  private fun buildTexMatrix(
    out: FloatArray,
    coverX: Float,
    coverY: Float,
    motionType: String,
    amount: Float,
    t: Float,
  ) {
    var zoom = 1f
    var panU = 0f
    var panV = 0f
    val tight = 1f / (1f + amount) // sampled region shrinks → magnified
    when (motionType) {
      "zoomIn" -> zoom = lerp(1f, tight, t)
      "zoomOut" -> zoom = lerp(tight, 1f, t)
      "panLR" -> { zoom = tight; panU = lerp(amount * 0.5f, -amount * 0.5f, t) }
      "panRL" -> { zoom = tight; panU = lerp(-amount * 0.5f, amount * 0.5f, t) }
      else -> {}
    }
    Matrix.setIdentityM(out, 0)
    Matrix.translateM(out, 0, 0.5f + panU, 0.5f + panV, 0f)
    Matrix.scaleM(out, 0, coverX * zoom, coverY * zoom, 1f)
    Matrix.translateM(out, 0, -0.5f, -0.5f, 0f)
  }

  private fun lerp(a: Float, b: Float, t: Float): Float = a + (b - a) * t

  private fun loadBitmap(uri: String, maxDim: Int): Bitmap {
    val parsed = Uri.parse(uri)
    val resolver = context.contentResolver

    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(parsed).use { BitmapFactory.decodeStream(it, null, bounds) }

    var sample = 1
    while (bounds.outWidth / sample > maxDim || bounds.outHeight / sample > maxDim) sample *= 2
    val opts = BitmapFactory.Options().apply { inSampleSize = sample }
    val decoded = resolver.openInputStream(parsed).use { BitmapFactory.decodeStream(it, null, opts) }
      ?: throw IllegalStateException("Failed to decode photo: $uri")

    val orientation = try {
      resolver.openInputStream(parsed).use { input ->
        if (input != null) ExifInterface(input).getAttributeInt(
          ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL,
        ) else ExifInterface.ORIENTATION_NORMAL
      }
    } catch (_: Exception) {
      ExifInterface.ORIENTATION_NORMAL
    }
    return applyExifOrientation(decoded, orientation)
  }

  private fun applyExifOrientation(bmp: Bitmap, orientation: Int): Bitmap {
    val m = GfxMatrix()
    when (orientation) {
      ExifInterface.ORIENTATION_ROTATE_90 -> m.postRotate(90f)
      ExifInterface.ORIENTATION_ROTATE_180 -> m.postRotate(180f)
      ExifInterface.ORIENTATION_ROTATE_270 -> m.postRotate(270f)
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> m.postScale(-1f, 1f)
      ExifInterface.ORIENTATION_FLIP_VERTICAL -> m.postScale(1f, -1f)
      else -> return bmp
    }
    val rotated = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
    if (rotated != bmp) bmp.recycle()
    return rotated
  }

  /** Minimal EGL + 2D-texture GL for drawing a bitmap to the encoder's input surface. */
  private class Egl(private val surface: Surface) {
    private var display: EGLDisplay = EGL14.EGL_NO_DISPLAY
    private var contextEgl: EGLContext = EGL14.EGL_NO_CONTEXT
    private var eglSurface: EGLSurface = EGL14.EGL_NO_SURFACE
    private var program = 0
    private var aPos = 0
    private var aTex = 0
    private var uTexMatrix = 0

    private val vertexData: FloatBuffer = ByteBuffer
      .allocateDirect(VERTICES.size * 4)
      .order(ByteOrder.nativeOrder())
      .asFloatBuffer()
      .apply { put(VERTICES).position(0) }

    fun setup() {
      display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
      val version = IntArray(2)
      EGL14.eglInitialize(display, version, 0, version, 1)
      val attribs = intArrayOf(
        EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8, EGL14.EGL_ALPHA_SIZE, 8,
        EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
        EGLExt.EGL_RECORDABLE_ANDROID, 1, EGL14.EGL_NONE,
      )
      val configs = arrayOfNulls<EGLConfig>(1)
      val num = IntArray(1)
      EGL14.eglChooseConfig(display, attribs, 0, configs, 0, 1, num, 0)
      val ctxAttribs = intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE)
      contextEgl = EGL14.eglCreateContext(display, configs[0], EGL14.EGL_NO_CONTEXT, ctxAttribs, 0)
      eglSurface = EGL14.eglCreateWindowSurface(display, configs[0], surface, intArrayOf(EGL14.EGL_NONE), 0)
      EGL14.eglMakeCurrent(display, eglSurface, eglSurface, contextEgl)

      program = buildProgram()
      aPos = GLES20.glGetAttribLocation(program, "aPosition")
      aTex = GLES20.glGetAttribLocation(program, "aTextureCoord")
      uTexMatrix = GLES20.glGetUniformLocation(program, "uTexMatrix")
    }

    fun uploadBitmap(bmp: Bitmap): Int {
      val ids = IntArray(1)
      GLES20.glGenTextures(1, ids, 0)
      val id = ids[0]
      GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, id)
      GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
      GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
      GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
      GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
      GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bmp, 0)
      return id
    }

    fun draw(texId: Int, texMatrix: FloatArray, w: Int, h: Int) {
      GLES20.glViewport(0, 0, w, h)
      GLES20.glClearColor(0f, 0f, 0f, 1f)
      GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
      GLES20.glUseProgram(program)

      vertexData.position(0)
      GLES20.glEnableVertexAttribArray(aPos)
      GLES20.glVertexAttribPointer(aPos, 2, GLES20.GL_FLOAT, false, STRIDE, vertexData)
      vertexData.position(2)
      GLES20.glEnableVertexAttribArray(aTex)
      GLES20.glVertexAttribPointer(aTex, 2, GLES20.GL_FLOAT, false, STRIDE, vertexData)

      GLES20.glUniformMatrix4fv(uTexMatrix, 1, false, texMatrix, 0)
      GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
      GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texId)
      GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)

      GLES20.glDisableVertexAttribArray(aPos)
      GLES20.glDisableVertexAttribArray(aTex)
    }

    fun setPresentationTime(nsecs: Long) {
      EGLExt.eglPresentationTimeANDROID(display, eglSurface, nsecs)
    }

    fun swapBuffers(): Boolean = EGL14.eglSwapBuffers(display, eglSurface)

    fun release() {
      if (display != EGL14.EGL_NO_DISPLAY) {
        EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
        EGL14.eglDestroySurface(display, eglSurface)
        EGL14.eglDestroyContext(display, contextEgl)
        EGL14.eglReleaseThread()
        EGL14.eglTerminate(display)
      }
      display = EGL14.EGL_NO_DISPLAY
      contextEgl = EGL14.EGL_NO_CONTEXT
      eglSurface = EGL14.EGL_NO_SURFACE
    }

    private fun buildProgram(): Int {
      val vs = compile(GLES20.GL_VERTEX_SHADER, VERTEX_SHADER)
      val fs = compile(GLES20.GL_FRAGMENT_SHADER, FRAGMENT_SHADER)
      val prog = GLES20.glCreateProgram()
      GLES20.glAttachShader(prog, vs)
      GLES20.glAttachShader(prog, fs)
      GLES20.glLinkProgram(prog)
      val linked = IntArray(1)
      GLES20.glGetProgramiv(prog, GLES20.GL_LINK_STATUS, linked, 0)
      if (linked[0] == 0) {
        val log = GLES20.glGetProgramInfoLog(prog)
        GLES20.glDeleteProgram(prog)
        throw RuntimeException("photo program link failed: $log")
      }
      return prog
    }

    private fun compile(type: Int, src: String): Int {
      val shader = GLES20.glCreateShader(type)
      GLES20.glShaderSource(shader, src)
      GLES20.glCompileShader(shader)
      val ok = IntArray(1)
      GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, ok, 0)
      if (ok[0] == 0) {
        val log = GLES20.glGetShaderInfoLog(shader)
        GLES20.glDeleteShader(shader)
        throw RuntimeException("photo shader compile failed: $log")
      }
      return shader
    }
  }

  companion object {
    private const val MIME = "video/avc"
    private const val FPS = 30
    private const val STRIDE = 4 * 4
    // x, y, u, v — full-screen quad. v flipped (1→0) so the bitmap isn't upside-down.
    private val VERTICES = floatArrayOf(
      -1f, -1f, 0f, 1f,
      1f, -1f, 1f, 1f,
      -1f, 1f, 0f, 0f,
      1f, 1f, 1f, 0f,
    )

    private const val VERTEX_SHADER = """
      attribute vec4 aPosition;
      attribute vec4 aTextureCoord;
      uniform mat4 uTexMatrix;
      varying vec2 vTextureCoord;
      void main() {
        gl_Position = aPosition;
        vTextureCoord = (uTexMatrix * vec4(aTextureCoord.xy, 0.0, 1.0)).xy;
      }
    """

    private const val FRAGMENT_SHADER = """
      precision mediump float;
      varying vec2 vTextureCoord;
      uniform sampler2D sTexture;
      void main() {
        gl_FragColor = texture2D(sTexture, vTextureCoord);
      }
    """
  }
}
