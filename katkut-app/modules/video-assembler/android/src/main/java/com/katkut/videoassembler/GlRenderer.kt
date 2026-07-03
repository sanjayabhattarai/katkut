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
 * to the encoder surface with a "cover" fit to the output canvas — UNCHANGED, used for
 * portrait/vertical sources that already fill the canvas without cropping.
 *
 * Blurred-fill (HARD RULE 2, landscape/square sources): drawBlurredFillFrame() composites the
 * same decoded frame twice — once cover-cropped + blurred as a full-canvas backdrop, once
 * contain-fit sharp on top — instead of hard-cropping. Both draws sample the SAME already-latched
 * OES texture (no second decode). This is entirely additive: the original program/shaders/
 * drawFrame() above are untouched, so the already-working portrait path can't regress.
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

  // --- blurred-fill additions (all additive; nothing above this line is touched) ---
  private var programContain = 0 // OES sampler + a position-scale matrix (letterbox/pillarbox fit)
  private var cAPositionLoc = 0
  private var cATextureCoordLoc = 0
  private var cUStMatrixLoc = 0
  private var cUCropMatrixLoc = 0
  private var cUPosMatrixLoc = 0

  private var program2D = 0 // plain 2D texture sampler: separable blur pass + final tinted upsample
  private var tAPositionLoc = 0
  private var tATextureCoordLoc = 0
  private var tUCropMatrixLoc = 0
  private var tUBlurStepLoc = 0
  private var tUTintLoc = 0

  private var fboA = 0
  private var texA = 0
  private var fboB = 0
  private var texB = 0
  private var blurSmallW = 0
  private var blurSmallH = 0
  private var blurFbosReady = false

  private val bgCropMatrix = FloatArray(16)
  private val fgPosMatrix = FloatArray(16)

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

    // --- blurred-fill: build the two additional programs (existing `program` untouched) ---
    programContain = buildProgram(CONTAIN_VERTEX_SHADER, FRAGMENT_SHADER)
    cAPositionLoc = GLES20.glGetAttribLocation(programContain, "aPosition")
    cATextureCoordLoc = GLES20.glGetAttribLocation(programContain, "aTextureCoord")
    cUStMatrixLoc = GLES20.glGetUniformLocation(programContain, "uStMatrix")
    cUCropMatrixLoc = GLES20.glGetUniformLocation(programContain, "uCropMatrix")
    cUPosMatrixLoc = GLES20.glGetUniformLocation(programContain, "uPosMatrix")

    program2D = buildProgram(TEX2D_VERTEX_SHADER, TEX2D_FRAGMENT_SHADER)
    tAPositionLoc = GLES20.glGetAttribLocation(program2D, "aPosition")
    tATextureCoordLoc = GLES20.glGetAttribLocation(program2D, "aTextureCoord")
    tUCropMatrixLoc = GLES20.glGetUniformLocation(program2D, "uCropMatrix")
    tUBlurStepLoc = GLES20.glGetUniformLocation(program2D, "uBlurStep")
    tUTintLoc = GLES20.glGetUniformLocation(program2D, "uTintColor")
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

  /**
   * Precompute the two matrices blurred-fill needs for a source of the given aspect (called once
   * per segment, like setCoverCrop): the background's cover-crop (same math as setCoverCrop, used
   * to fill the small blur FBO) and the foreground's contain-fit position scale (shrinks the
   * geometry — not the texture coords — so the full frame is visible, centered, un-cropped).
   */
  fun setBlurredFill(srcAspect: Double, dstAspect: Double) {
    Matrix.setIdentityM(bgCropMatrix, 0)
    var sx = 1f
    var sy = 1f
    if (srcAspect > dstAspect) sx = (dstAspect / srcAspect).toFloat() else sy = (srcAspect / dstAspect).toFloat()
    Matrix.translateM(bgCropMatrix, 0, 0.5f, 0.5f, 0f)
    Matrix.scaleM(bgCropMatrix, 0, sx, sy, 1f)
    Matrix.translateM(bgCropMatrix, 0, -0.5f, -0.5f, 0f)

    Matrix.setIdentityM(fgPosMatrix, 0)
    var psx = 1f
    var psy = 1f
    // contain fit is the mirror of cover: the LARGER relative dimension of the geometry shrinks
    // (instead of the smaller dimension's texture coords being cropped away).
    if (srcAspect >= dstAspect) psy = (dstAspect / srcAspect).toFloat() else psx = (srcAspect / dstAspect).toFloat()
    Matrix.scaleM(fgPosMatrix, 0, psx, psy, 1f)
  }

  private fun createFbo(w: Int, h: Int): Pair<Int, Int> {
    val tex = IntArray(1)
    GLES20.glGenTextures(1, tex, 0)
    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, tex[0])
    GLES20.glTexImage2D(
      GLES20.GL_TEXTURE_2D, 0, GLES20.GL_RGBA, w, h, 0,
      GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, null,
    )
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)

    val fbo = IntArray(1)
    GLES20.glGenFramebuffers(1, fbo, 0)
    GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, fbo[0])
    GLES20.glFramebufferTexture2D(
      GLES20.GL_FRAMEBUFFER, GLES20.GL_COLOR_ATTACHMENT0, GLES20.GL_TEXTURE_2D, tex[0], 0,
    )
    val status = GLES20.glCheckFramebufferStatus(GLES20.GL_FRAMEBUFFER)
    GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
    if (status != GLES20.GL_FRAMEBUFFER_COMPLETE) {
      throw RuntimeException("blurred-fill FBO incomplete: $status")
    }
    return Pair(fbo[0], tex[0])
  }

  /** Lazily create the two small ping-pong FBOs, sized once from the FIRST call's canvas aspect
   *  (constant for the life of one assemble()/makeProxy() run). */
  private fun ensureBlurFbos(dstW: Int, dstH: Int) {
    if (blurFbosReady) return
    val dstAspect = dstW.toDouble() / dstH.toDouble()
    blurSmallW = BLUR_SMALL_W
    blurSmallH = (BLUR_SMALL_W / dstAspect).let { if (it < 1.0) 1 else Math.round(it).toInt() }
    val (fa, ta) = createFbo(blurSmallW, blurSmallH)
    val (fb, tb) = createFbo(blurSmallW, blurSmallH)
    fboA = fa; texA = ta
    fboB = fb; texB = tb
    blurFbosReady = true
  }

  /**
   * Draw the currently-latched OES frame as a full canvas: a small cover-cropped copy blurred
   * (2-pass separable, ping-ponged through the small FBOs) and tinted as the backdrop, then the
   * SAME frame again on top, contain-fit and sharp. Same texture, same latched frame — no second
   * decode; the extra cost is a few cheap draws over a small offscreen surface plus one more
   * full-size draw, not a second video pipeline.
   */
  fun drawBlurredFillFrame(widthPx: Int, heightPx: Int) {
    ensureBlurFbos(widthPx, heightPx)

    // Pass 1: cover-crop the OES frame into small FBO A (reuses the existing OES program/shader —
    // functionally identical to drawFrame(), just targeting a small offscreen surface).
    GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, fboA)
    GLES20.glViewport(0, 0, blurSmallW, blurSmallH)
    GLES20.glClearColor(0f, 0f, 0f, 1f)
    GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
    drawOesQuad(program, aPositionLoc, aTextureCoordLoc, uStMatrixLoc, uCropMatrixLoc, bgCropMatrix)

    // Pass 2: horizontal blur, FBO A → FBO B.
    GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, fboB)
    GLES20.glViewport(0, 0, blurSmallW, blurSmallH)
    GLES20.glClearColor(0f, 0f, 0f, 1f)
    GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
    draw2DQuad(texA, IDENTITY_MATRIX, 1f / blurSmallW, 0f, NO_TINT)

    // Pass 3: vertical blur, FBO B → FBO A (ping-pong reuse — fully blurred small backdrop now in A).
    GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, fboA)
    GLES20.glViewport(0, 0, blurSmallW, blurSmallH)
    GLES20.glClearColor(0f, 0f, 0f, 1f)
    GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
    draw2DQuad(texB, IDENTITY_MATRIX, 0f, 1f / blurSmallH, NO_TINT)

    // Pass 4: upsample the blurred small backdrop to the full canvas, with a dark tint.
    GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
    GLES20.glViewport(0, 0, widthPx, heightPx)
    GLES20.glClearColor(0f, 0f, 0f, 1f)
    GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
    draw2DQuad(texA, IDENTITY_MATRIX, 0f, 0f, TINT_COLOR)

    // Pass 5: sharp foreground, contain-fit, layered on top (no clear — draws over pass 4).
    drawOesQuad(programContain, cAPositionLoc, cATextureCoordLoc, cUStMatrixLoc, cUCropMatrixLoc, IDENTITY_MATRIX, cUPosMatrixLoc, fgPosMatrix)
  }

  /** Shared OES-quad draw, parameterized by program/locations so drawFrame() itself is untouched. */
  private fun drawOesQuad(
    prog: Int,
    posLoc: Int,
    texLoc: Int,
    stLoc: Int,
    cropLoc: Int,
    cropMat: FloatArray,
    posMatLoc: Int = -1,
    posMat: FloatArray = IDENTITY_MATRIX,
  ) {
    GLES20.glUseProgram(prog)

    vertexData.position(0)
    GLES20.glEnableVertexAttribArray(posLoc)
    GLES20.glVertexAttribPointer(posLoc, 2, GLES20.GL_FLOAT, false, STRIDE, vertexData)

    vertexData.position(2)
    GLES20.glEnableVertexAttribArray(texLoc)
    GLES20.glVertexAttribPointer(texLoc, 2, GLES20.GL_FLOAT, false, STRIDE, vertexData)

    GLES20.glUniformMatrix4fv(stLoc, 1, false, stMatrix, 0)
    GLES20.glUniformMatrix4fv(cropLoc, 1, false, cropMat, 0)
    if (posMatLoc >= 0) GLES20.glUniformMatrix4fv(posMatLoc, 1, false, posMat, 0)

    GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
    GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)

    GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)

    GLES20.glDisableVertexAttribArray(posLoc)
    GLES20.glDisableVertexAttribArray(texLoc)
  }

  /** 2D-texture quad draw used for the blur passes and the final tinted upsample. */
  private fun draw2DQuad(srcTexId: Int, cropMat: FloatArray, blurStepX: Float, blurStepY: Float, tint: FloatArray) {
    GLES20.glUseProgram(program2D)

    vertexData.position(0)
    GLES20.glEnableVertexAttribArray(tAPositionLoc)
    GLES20.glVertexAttribPointer(tAPositionLoc, 2, GLES20.GL_FLOAT, false, STRIDE, vertexData)

    vertexData.position(2)
    GLES20.glEnableVertexAttribArray(tATextureCoordLoc)
    GLES20.glVertexAttribPointer(tATextureCoordLoc, 2, GLES20.GL_FLOAT, false, STRIDE, vertexData)

    GLES20.glUniformMatrix4fv(tUCropMatrixLoc, 1, false, cropMat, 0)
    GLES20.glUniform2f(tUBlurStepLoc, blurStepX, blurStepY)
    GLES20.glUniform4f(tUTintLoc, tint[0], tint[1], tint[2], tint[3])

    GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, srcTexId)

    GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)

    GLES20.glDisableVertexAttribArray(tAPositionLoc)
    GLES20.glDisableVertexAttribArray(tATextureCoordLoc)
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
    if (blurFbosReady) {
      GLES20.glDeleteFramebuffers(2, intArrayOf(fboA, fboB), 0)
      GLES20.glDeleteTextures(2, intArrayOf(texA, texB), 0)
      blurFbosReady = false
    }
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

    // --- blurred-fill additions ---

    private const val BLUR_SMALL_W = 160 // small FBO width; height derives from canvas aspect

    private val IDENTITY_MATRIX = FloatArray(16).also { Matrix.setIdentityM(it, 0) }
    private val NO_TINT = floatArrayOf(0f, 0f, 0f, 0f) // alpha 0 = no tint mix
    private val TINT_COLOR = floatArrayOf(0f, 0f, 0f, 0.35f) // dark tint, per the design spec

    // Same as VERTEX_SHADER but adds a position-scale matrix, used ONLY for the contain-fit
    // foreground pass — the original VERTEX_SHADER/program above is untouched.
    private const val CONTAIN_VERTEX_SHADER = """
      attribute vec4 aPosition;
      attribute vec4 aTextureCoord;
      uniform mat4 uStMatrix;
      uniform mat4 uCropMatrix;
      uniform mat4 uPosMatrix;
      varying vec2 vTextureCoord;
      void main() {
        gl_Position = uPosMatrix * aPosition;
        vec4 cropped = uCropMatrix * vec4(aTextureCoord.xy, 0.0, 1.0);
        vTextureCoord = (uStMatrix * vec4(cropped.xy, 0.0, 1.0)).xy;
      }
    """

    // Plain 2D-texture quad (no OES, no stMatrix) used for the blur ping-pong passes and the
    // final tinted upsample. Crop matrix lets it reuse the same cover/contain math if ever needed;
    // the blur/tint passes here always pass identity (full source, 0..1).
    private const val TEX2D_VERTEX_SHADER = """
      attribute vec4 aPosition;
      attribute vec4 aTextureCoord;
      uniform mat4 uCropMatrix;
      varying vec2 vTextureCoord;
      void main() {
        gl_Position = aPosition;
        vTextureCoord = (uCropMatrix * vec4(aTextureCoord.xy, 0.0, 1.0)).xy;
      }
    """

    // 9-tap separable blur (standard normalized Gaussian-ish weights, sum to 1.0) along
    // uBlurStep (a texel offset in ONE axis per pass — horizontal then vertical = full 2D blur).
    // uBlurStep = (0,0) degenerates to 9 identical samples = an unblurred passthrough, which is
    // how the final upsample+tint pass reuses this same shader with no blur.
    // uTintColor.a mixes the result toward uTintColor.rgb (0 = no tint).
    private const val TEX2D_FRAGMENT_SHADER = """
      precision mediump float;
      varying vec2 vTextureCoord;
      uniform sampler2D sTexture2D;
      uniform vec2 uBlurStep;
      uniform vec4 uTintColor;
      void main() {
        vec4 sum = vec4(0.0);
        sum += texture2D(sTexture2D, vTextureCoord - 4.0 * uBlurStep) * 0.0162162162;
        sum += texture2D(sTexture2D, vTextureCoord - 3.0 * uBlurStep) * 0.0540540541;
        sum += texture2D(sTexture2D, vTextureCoord - 2.0 * uBlurStep) * 0.1216216216;
        sum += texture2D(sTexture2D, vTextureCoord - 1.0 * uBlurStep) * 0.1945945946;
        sum += texture2D(sTexture2D, vTextureCoord)                   * 0.2270270270;
        sum += texture2D(sTexture2D, vTextureCoord + 1.0 * uBlurStep) * 0.1945945946;
        sum += texture2D(sTexture2D, vTextureCoord + 2.0 * uBlurStep) * 0.1216216216;
        sum += texture2D(sTexture2D, vTextureCoord + 3.0 * uBlurStep) * 0.0540540541;
        sum += texture2D(sTexture2D, vTextureCoord + 4.0 * uBlurStep) * 0.0162162162;
        gl_FragColor = mix(sum, vec4(uTintColor.rgb, sum.a), uTintColor.a);
      }
    """
  }
}
