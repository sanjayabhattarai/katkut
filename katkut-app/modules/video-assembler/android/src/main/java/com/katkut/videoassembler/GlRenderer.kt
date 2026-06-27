package com.katkut.videoassembler

import android.graphics.SurfaceTexture
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLExt
import android.opengl.EGLSurface
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.opengl.Matrix
import android.os.Handler
import android.os.HandlerThread
import android.view.Surface
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer

/**
 * EGL context bound to the encoder's input Surface, plus a SurfaceTexture (external texture)
 * that the video decoder renders into. drawFrame() samples the decoded frame and draws it
 * to the encoder surface with a "cover" fit to the output canvas.
 *
 * Blurred-fill (HARD RULE 2 for non-vertical clips) is a later spike that extends this shader.
 */
class GlRenderer(private val encoderSurface: Surface) {

  private var eglDisplay: EGLDisplay = EGL14.EGL_NO_DISPLAY
  private var eglContext: EGLContext = EGL14.EGL_NO_CONTEXT
  private var eglSurface: EGLSurface = EGL14.EGL_NO_SURFACE

  private var program = 0
  private var textureId = 0
  private var aPositionLoc = 0
  private var aTextureCoordLoc = 0
  private var uStMatrixLoc = 0
  private var uCropMatrixLoc = 0

  lateinit var surfaceTexture: SurfaceTexture
    private set
  lateinit var decoderSurface: Surface
    private set

  private val stMatrix = FloatArray(16)
  private val cropMatrix = FloatArray(16)

  private val frameSyncLock = Object()
  private var frameAvailable = false
  private var frameThread: HandlerThread? = null

  private val vertexData: FloatBuffer = ByteBuffer
    .allocateDirect(VERTICES.size * 4)
    .order(ByteOrder.nativeOrder())
    .asFloatBuffer()
    .apply { put(VERTICES).position(0) }

  fun setup() {
    initEgl()
    makeCurrent()
    program = buildProgram(VERTEX_SHADER, FRAGMENT_SHADER)
    aPositionLoc = GLES20.glGetAttribLocation(program, "aPosition")
    aTextureCoordLoc = GLES20.glGetAttribLocation(program, "aTextureCoord")
    uStMatrixLoc = GLES20.glGetUniformLocation(program, "uStMatrix")
    uCropMatrixLoc = GLES20.glGetUniformLocation(program, "uCropMatrix")

    val textures = IntArray(1)
    GLES20.glGenTextures(1, textures, 0)
    textureId = textures[0]
    GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)

    surfaceTexture = SurfaceTexture(textureId)
    val ht = HandlerThread("FrameSync").also { it.start() }
    frameThread = ht
    surfaceTexture.setOnFrameAvailableListener({
      synchronized(frameSyncLock) {
        frameAvailable = true
        frameSyncLock.notifyAll()
      }
    }, Handler(ht.looper))
    decoderSurface = Surface(surfaceTexture)
    Matrix.setIdentityM(cropMatrix, 0)
  }

  /**
   * Set the "cover" crop for a source of the given displayed aspect ratio against the
   * output canvas aspect. Scales texture coords around center so the source fills the
   * canvas with no distortion (excess is cropped).
   */
  fun setCoverCrop(srcAspect: Double, dstAspect: Double) {
    Matrix.setIdentityM(cropMatrix, 0)
    var sx = 1f
    var sy = 1f
    if (srcAspect > dstAspect) {
      // source too wide → crop horizontally
      sx = (dstAspect / srcAspect).toFloat()
    } else {
      // source too tall → crop vertically
      sy = (srcAspect / dstAspect).toFloat()
    }
    // scale around (0.5, 0.5)
    Matrix.translateM(cropMatrix, 0, 0.5f, 0.5f, 0f)
    Matrix.scaleM(cropMatrix, 0, sx, sy, 1f)
    Matrix.translateM(cropMatrix, 0, -0.5f, -0.5f, 0f)
  }

  /** Wait for the decoder to deliver a new frame, then latch it into the external texture. */
  fun awaitNewImage(timeoutMs: Long = 2500): Boolean {
    synchronized(frameSyncLock) {
      val deadline = System.currentTimeMillis() + timeoutMs
      while (!frameAvailable) {
        val remaining = deadline - System.currentTimeMillis()
        if (remaining <= 0) return false
        try {
          frameSyncLock.wait(remaining)
        } catch (_: InterruptedException) {
          return false
        }
      }
      frameAvailable = false
    }
    surfaceTexture.updateTexImage()
    surfaceTexture.getTransformMatrix(stMatrix)
    return true
  }

  fun drawFrame(widthPx: Int, heightPx: Int) {
    GLES20.glViewport(0, 0, widthPx, heightPx)
    GLES20.glClearColor(0f, 0f, 0f, 1f)
    GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)

    GLES20.glUseProgram(program)

    vertexData.position(0)
    GLES20.glEnableVertexAttribArray(aPositionLoc)
    GLES20.glVertexAttribPointer(aPositionLoc, 2, GLES20.GL_FLOAT, false, STRIDE, vertexData)

    vertexData.position(2)
    GLES20.glEnableVertexAttribArray(aTextureCoordLoc)
    GLES20.glVertexAttribPointer(aTextureCoordLoc, 2, GLES20.GL_FLOAT, false, STRIDE, vertexData)

    GLES20.glUniformMatrix4fv(uStMatrixLoc, 1, false, stMatrix, 0)
    GLES20.glUniformMatrix4fv(uCropMatrixLoc, 1, false, cropMatrix, 0)

    GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
    GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)

    GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)

    GLES20.glDisableVertexAttribArray(aPositionLoc)
    GLES20.glDisableVertexAttribArray(aTextureCoordLoc)
  }

  fun setPresentationTime(nsecs: Long) {
    EGLExt.eglPresentationTimeANDROID(eglDisplay, eglSurface, nsecs)
  }

  fun swapBuffers(): Boolean {
    return EGL14.eglSwapBuffers(eglDisplay, eglSurface)
  }

  fun makeCurrent() {
    if (!EGL14.eglMakeCurrent(eglDisplay, eglSurface, eglSurface, eglContext)) {
      throw RuntimeException("eglMakeCurrent failed")
    }
  }

  fun release() {
    if (eglDisplay != EGL14.EGL_NO_DISPLAY) {
      EGL14.eglMakeCurrent(
        eglDisplay,
        EGL14.EGL_NO_SURFACE,
        EGL14.EGL_NO_SURFACE,
        EGL14.EGL_NO_CONTEXT,
      )
      EGL14.eglDestroySurface(eglDisplay, eglSurface)
      EGL14.eglDestroyContext(eglDisplay, eglContext)
      EGL14.eglReleaseThread()
      EGL14.eglTerminate(eglDisplay)
    }
    eglDisplay = EGL14.EGL_NO_DISPLAY
    eglContext = EGL14.EGL_NO_CONTEXT
    eglSurface = EGL14.EGL_NO_SURFACE
    if (::decoderSurface.isInitialized) decoderSurface.release()
    if (::surfaceTexture.isInitialized) surfaceTexture.release()
    frameThread?.quitSafely()
    frameThread = null
  }

  private fun initEgl() {
    eglDisplay = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
    if (eglDisplay == EGL14.EGL_NO_DISPLAY) throw RuntimeException("no EGL display")
    val version = IntArray(2)
    if (!EGL14.eglInitialize(eglDisplay, version, 0, version, 1)) {
      throw RuntimeException("eglInitialize failed")
    }
    val attribList = intArrayOf(
      EGL14.EGL_RED_SIZE, 8,
      EGL14.EGL_GREEN_SIZE, 8,
      EGL14.EGL_BLUE_SIZE, 8,
      EGL14.EGL_ALPHA_SIZE, 8,
      EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
      EGLExt.EGL_RECORDABLE_ANDROID, 1,
      EGL14.EGL_NONE,
    )
    val configs = arrayOfNulls<EGLConfig>(1)
    val numConfigs = IntArray(1)
    if (!EGL14.eglChooseConfig(eglDisplay, attribList, 0, configs, 0, 1, numConfigs, 0)) {
      throw RuntimeException("eglChooseConfig failed")
    }
    val ctxAttribs = intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE)
    eglContext = EGL14.eglCreateContext(
      eglDisplay, configs[0], EGL14.EGL_NO_CONTEXT, ctxAttribs, 0,
    )
    val surfaceAttribs = intArrayOf(EGL14.EGL_NONE)
    eglSurface = EGL14.eglCreateWindowSurface(
      eglDisplay, configs[0], encoderSurface, surfaceAttribs, 0,
    )
    if (eglSurface == EGL14.EGL_NO_SURFACE) throw RuntimeException("eglCreateWindowSurface failed")
  }

  private fun buildProgram(vs: String, fs: String): Int {
    val vShader = compileShader(GLES20.GL_VERTEX_SHADER, vs)
    val fShader = compileShader(GLES20.GL_FRAGMENT_SHADER, fs)
    val prog = GLES20.glCreateProgram()
    GLES20.glAttachShader(prog, vShader)
    GLES20.glAttachShader(prog, fShader)
    GLES20.glLinkProgram(prog)
    val linked = IntArray(1)
    GLES20.glGetProgramiv(prog, GLES20.GL_LINK_STATUS, linked, 0)
    if (linked[0] == 0) {
      val log = GLES20.glGetProgramInfoLog(prog)
      GLES20.glDeleteProgram(prog)
      throw RuntimeException("program link failed: $log")
    }
    return prog
  }

  private fun compileShader(type: Int, src: String): Int {
    val shader = GLES20.glCreateShader(type)
    GLES20.glShaderSource(shader, src)
    GLES20.glCompileShader(shader)
    val compiled = IntArray(1)
    GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, compiled, 0)
    if (compiled[0] == 0) {
      val log = GLES20.glGetShaderInfoLog(shader)
      GLES20.glDeleteShader(shader)
      throw RuntimeException("shader compile failed: $log")
    }
    return shader
  }

  companion object {
    private const val STRIDE = 4 * 4 // 4 floats per vertex
    // x, y, u, v  (full-screen quad as triangle strip)
    private val VERTICES = floatArrayOf(
      -1f, -1f, 0f, 0f,
      1f, -1f, 1f, 0f,
      -1f, 1f, 0f, 1f,
      1f, 1f, 1f, 1f,
    )

    private const val VERTEX_SHADER = """
      attribute vec4 aPosition;
      attribute vec4 aTextureCoord;
      uniform mat4 uStMatrix;
      uniform mat4 uCropMatrix;
      varying vec2 vTextureCoord;
      void main() {
        gl_Position = aPosition;
        vec4 cropped = uCropMatrix * vec4(aTextureCoord.xy, 0.0, 1.0);
        vTextureCoord = (uStMatrix * vec4(cropped.xy, 0.0, 1.0)).xy;
      }
    """

    private const val FRAGMENT_SHADER = """
      #extension GL_OES_EGL_image_external : require
      precision mediump float;
      varying vec2 vTextureCoord;
      uniform samplerExternalOES sTexture;
      void main() {
        gl_FragColor = texture2D(sTexture, vTextureCoord);
      }
    """
  }
}
