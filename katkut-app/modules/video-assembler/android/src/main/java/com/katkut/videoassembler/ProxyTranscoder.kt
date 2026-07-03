package com.katkut.videoassembler

import android.content.Context
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.media.MediaMuxer
import android.net.Uri
import java.nio.ByteBuffer

/**
 * Generate a low-res PREVIEW PROXY of one source clip: the whole clip, downscaled to a uniform
 * 720x1280 (9:16) H.264 frame (same cover-scale the exporter uses), with audio passed through.
 *
 * Why: the preview player concatenates clips on a single hardware decoder. Mixed source
 * resolutions/codecs force the decoder to reconfigure at each clip boundary → a visible freeze.
 * Rendering every clip to ONE uniform proxy format makes the decoder run truly gapless.
 *
 * Proxies are throwaway (preview only). Export always uses the untouched full-res originals.
 * No FFmpeg (HARD RULE 9); hardware encoder (HARD RULE 8); reuses GlRenderer.
 */
class ProxyTranscoder(private val context: Context) {

  private class MuxState(val muxer: MediaMuxer) {
    var started = false
    var videoTrack = -1
    var audioTrack = -1
    var audioFormat: MediaFormat? = null
  }

  fun makeProxy(uri: String, outputPath: String) {
    val parsed = Uri.parse(uri)
    val srcAspect = displayedAspect(parsed)
    // Same blurred-fill rule as export (HARD RULE 2) so preview matches the final render exactly —
    // both paths run through the identical GlRenderer shader.
    val dstAspect = OUT_W.toDouble() / OUT_H.toDouble()
    val blurredFill = srcAspect > dstAspect

    val encoderFormat = MediaFormat.createVideoFormat(MIME, OUT_W, OUT_H).apply {
      setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
      setInteger(MediaFormat.KEY_BIT_RATE, BITRATE)
      setInteger(MediaFormat.KEY_FRAME_RATE, FPS)
      setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, IFRAME_INTERVAL)
    }
    val encoder = MediaCodec.createEncoderByType(MIME)
    encoder.configure(encoderFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    val inputSurface = encoder.createInputSurface()
    val renderer = GlRenderer(inputSurface)
    renderer.setup()
    if (blurredFill) renderer.setBlurredFill(srcAspect, dstAspect) else renderer.setCoverCrop(srcAspect, dstAspect)
    encoder.start()

    val muxer = MediaMuxer(outputPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    val muxState = MuxState(muxer)

    // audio is passed through (copied, not re-encoded) — format known up front so its track
    // can be added before muxer.start()
    val audioExtractor = MediaExtractor()
    var audioTrackSrc = -1
    try {
      audioExtractor.setDataSource(context, parsed, null)
      for (i in 0 until audioExtractor.trackCount) {
        val f = audioExtractor.getTrackFormat(i)
        if (f.getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true) {
          audioTrackSrc = i
          muxState.audioFormat = f
          break
        }
      }
    } catch (_: Exception) {
      muxState.audioFormat = null
    }

    val extractor = MediaExtractor()
    var decoder: MediaCodec? = null
    val encInfo = MediaCodec.BufferInfo()

    try {
      extractor.setDataSource(context, parsed, null)
      var vTrack = -1
      var format: MediaFormat? = null
      for (i in 0 until extractor.trackCount) {
        val f = extractor.getTrackFormat(i)
        if (f.getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true) {
          vTrack = i
          format = f
          break
        }
      }
      if (vTrack < 0 || format == null) throw IllegalStateException("No video track in $uri")
      extractor.selectTrack(vTrack)

      decoder = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
      decoder.configure(format, renderer.decoderSurface, null, 0)
      decoder.start()

      val info = MediaCodec.BufferInfo()
      var sawInputEOS = false
      var sawOutputEOS = false
      var firstPts = -1L

      // --- transcode the whole video track, downscaled via GL ---
      while (!sawOutputEOS) {
        if (!sawInputEOS) {
          val inIdx = decoder.dequeueInputBuffer(10_000)
          if (inIdx >= 0) {
            val inBuf = decoder.getInputBuffer(inIdx)
            val size = if (inBuf != null) extractor.readSampleData(inBuf, 0) else -1
            if (size < 0) {
              decoder.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              sawInputEOS = true
            } else {
              decoder.queueInputBuffer(inIdx, 0, size, extractor.sampleTime, 0)
              extractor.advance()
            }
          }
        }

        val outIdx = decoder.dequeueOutputBuffer(info, 10_000)
        if (outIdx >= 0) {
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) sawOutputEOS = true
          val render = info.size > 0
          decoder.releaseOutputBuffer(outIdx, render)
          if (render) {
            if (firstPts < 0) firstPts = info.presentationTimeUs
            val outPts = info.presentationTimeUs - firstPts
            renderer.awaitNewImage()
            if (blurredFill) renderer.drawBlurredFillFrame(OUT_W, OUT_H) else renderer.drawFrame(OUT_W, OUT_H)
            renderer.setPresentationTime(outPts * 1000)
            renderer.swapBuffers()
            drainEncoder(encoder, muxState, encInfo, endOfStream = false)
          }
        }
      }

      encoder.signalEndOfInputStream()
      drainEncoder(encoder, muxState, encInfo, endOfStream = true)

      // --- copy the audio track through, unmodified ---
      val af = muxState.audioFormat
      if (af != null && audioTrackSrc >= 0 && muxState.started && muxState.audioTrack >= 0) {
        audioExtractor.selectTrack(audioTrackSrc)
        val maxIn = if (af.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) {
          af.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE)
        } else {
          256 * 1024
        }
        val buf = ByteBuffer.allocate(maxIn)
        val aInfo = MediaCodec.BufferInfo()
        while (true) {
          val size = audioExtractor.readSampleData(buf, 0)
          if (size < 0) break
          aInfo.set(0, size, audioExtractor.sampleTime, MediaCodec.BUFFER_FLAG_KEY_FRAME)
          muxer.writeSampleData(muxState.audioTrack, buf, aInfo)
          audioExtractor.advance()
        }
      }
    } finally {
      try { decoder?.stop() } catch (_: Exception) {}
      try { decoder?.release() } catch (_: Exception) {}
      try { extractor.release() } catch (_: Exception) {}
      try { audioExtractor.release() } catch (_: Exception) {}
      try { encoder.stop() } catch (_: Exception) {}
      try { encoder.release() } catch (_: Exception) {}
      renderer.release()
      try { if (muxState.started) muxer.stop() } catch (_: Exception) {}
      try { muxer.release() } catch (_: Exception) {}
    }
  }

  private fun drainEncoder(
    encoder: MediaCodec,
    muxState: MuxState,
    info: MediaCodec.BufferInfo,
    endOfStream: Boolean,
  ) {
    val timeoutUs = if (endOfStream) 10_000L else 0L
    while (true) {
      val outIdx = encoder.dequeueOutputBuffer(info, timeoutUs)
      if (outIdx == MediaCodec.INFO_TRY_AGAIN_LATER) {
        if (!endOfStream) return
      } else if (outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
        if (muxState.started) throw IllegalStateException("format changed twice")
        muxState.videoTrack = muxState.muxer.addTrack(encoder.outputFormat)
        muxState.audioFormat?.let { muxState.audioTrack = muxState.muxer.addTrack(it) }
        muxState.muxer.start()
        muxState.started = true
      } else if (outIdx >= 0) {
        val encoded = encoder.getOutputBuffer(outIdx)
          ?: throw IllegalStateException("null encoder output buffer")
        if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) info.size = 0
        if (info.size > 0 && muxState.started) {
          encoded.position(info.offset)
          encoded.limit(info.offset + info.size)
          muxState.muxer.writeSampleData(muxState.videoTrack, encoded, info)
        }
        encoder.releaseOutputBuffer(outIdx, false)
        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
      }
    }
  }

  private fun displayedAspect(uri: Uri): Double {
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(context, uri)
      val w = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: OUT_W
      val h = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: OUT_H
      val rot = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
      val (dw, dh) = if (rot == 90 || rot == 270) Pair(h, w) else Pair(w, h)
      return if (dh != 0) dw.toDouble() / dh.toDouble() else OUT_W.toDouble() / OUT_H.toDouble()
    } finally {
      retriever.release()
    }
  }

  companion object {
    private const val MIME = "video/avc"
    private const val OUT_W = 720
    private const val OUT_H = 1280
    // All-keyframe encoding (interval 0 = every frame is a sync frame). The preview player clips
    // each playlist item to an arbitrary in-point; with sparse keyframes ExoPlayer must decode and
    // discard every frame from the previous keyframe up to the in-point AT the clip boundary — a
    // visible stall on every transition. All-I makes any in-point start instantly. Costs bitrate,
    // hence 4 Mbps (proxies are throwaway preview files; export uses the originals).
    private const val BITRATE = 4_000_000
    private const val FPS = 30
    private const val IFRAME_INTERVAL = 0
  }
}
