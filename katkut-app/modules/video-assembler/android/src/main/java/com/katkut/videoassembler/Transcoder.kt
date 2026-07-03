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

data class Segment(
  val uri: String,
  val inSec: Double,
  val outSec: Double,
  val muted: Boolean = true,
)

/**
 * Trim + concat a list of segments into one 1080x1920 H.264 MP4 using the hardware encoder.
 * Each segment is decoded, cover-scaled via OpenGL, and re-encoded into a single muxer session
 * with continuous timestamps. Video-only for now (Smart mutes audio by default).
 */
class Transcoder(private val context: Context) {

  // Output dimensions/bitrate — default 1080x1920 (HARD RULE 2); "720p" is the fast-export option.
  private var outW = 1080
  private var outH = 1920
  private var bitrate = 10_000_000

  fun assemble(segments: List<Segment>, outputPath: String, audioMode: String, resolution: String) {
    if (segments.isEmpty()) throw IllegalArgumentException("No segments to assemble")

    if (resolution == "720p") {
      outW = 720; outH = 1280; bitrate = 5_000_000
    } else {
      outW = 1080; outH = 1920; bitrate = 10_000_000
    }

    // Build the audio track first so its format is known before muxer.start().
    val encodedAudio = buildAudio(segments, audioMode)

    val encoderFormat = MediaFormat.createVideoFormat(MIME, outW, outH).apply {
      setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
      setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
      setInteger(MediaFormat.KEY_FRAME_RATE, FPS)
      setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, IFRAME_INTERVAL)
    }

    val encoder = MediaCodec.createEncoderByType(MIME)
    encoder.configure(encoderFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    val inputSurface = encoder.createInputSurface()
    val renderer = GlRenderer(inputSurface)
    renderer.setup()
    encoder.start()

    val muxer = MediaMuxer(outputPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    val muxState = MuxState(muxer)
    muxState.audio = encodedAudio
    val encInfo = MediaCodec.BufferInfo()

    var timelineUs = 0L
    try {
      for (seg in segments) {
        timelineUs = transcodeSegment(seg, encoder, renderer, muxState, encInfo, timelineUs)
      }
      // flush encoder
      encoder.signalEndOfInputStream()
      drainEncoder(encoder, muxState, encInfo, endOfStream = true)
      // write the pre-encoded audio track (separate track, after all video samples)
      if (encodedAudio != null && muxState.started) {
        val audioInfo = MediaCodec.BufferInfo()
        for (p in encodedAudio.packets) {
          audioInfo.set(0, p.data.size, p.ptsUs, p.flags)
          muxer.writeSampleData(muxState.audioTrack, ByteBuffer.wrap(p.data), audioInfo)
        }
      }
    } finally {
      try { encoder.stop() } catch (_: Exception) {}
      try { encoder.release() } catch (_: Exception) {}
      renderer.release()
      try {
        if (muxState.started) muxer.stop()
      } catch (_: Exception) {}
      try { muxer.release() } catch (_: Exception) {}
    }
  }

  /** Resolve the per-clip mute flags against the global audioMode and encode the timeline audio. */
  private fun buildAudio(segments: List<Segment>, audioMode: String): EncodedAudio? {
    if (audioMode == "off") return null
    val effective = segments.map {
      val muted = when (audioMode) {
        "on" -> false
        else -> it.muted // "smart"
      }
      it.copy(muted = muted)
    }
    val needAudio = audioMode == "on" || effective.any { !it.muted }
    if (!needAudio) return null
    return AudioTimelineEncoder(context).encode(effective)
  }

  private fun transcodeSegment(
    seg: Segment,
    encoder: MediaCodec,
    renderer: GlRenderer,
    muxState: MuxState,
    encInfo: MediaCodec.BufferInfo,
    timelineStartUs: Long,
  ): Long {
    val parsed = Uri.parse(seg.uri)
    val inUs = (seg.inSec * 1_000_000).toLong()
    val outUs = (seg.outSec * 1_000_000).toLong()

    // HARD RULE 2: vertical sources fill (cover); landscape/square sources are shown uncropped,
    // centered, over a blurred fill of the same footage — never a hard crop, never black bars.
    val srcAspect = displayedAspect(parsed)
    val dstAspect = outW.toDouble() / outH.toDouble()
    val blurredFill = srcAspect > dstAspect
    if (blurredFill) renderer.setBlurredFill(srcAspect, dstAspect) else renderer.setCoverCrop(srcAspect, dstAspect)

    val extractor = MediaExtractor()
    var decoder: MediaCodec? = null
    var lastOutUs = timelineStartUs
    try {
      extractor.setDataSource(context, parsed, null)
      var trackIndex = -1
      var format: MediaFormat? = null
      for (i in 0 until extractor.trackCount) {
        val f = extractor.getTrackFormat(i)
        val mime = f.getString(MediaFormat.KEY_MIME) ?: continue
        if (mime.startsWith("video/")) {
          trackIndex = i
          format = f
          break
        }
      }
      if (trackIndex < 0 || format == null) throw IllegalStateException("No video track in ${seg.uri}")
      extractor.selectTrack(trackIndex)
      extractor.seekTo(inUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)

      val mime = format.getString(MediaFormat.KEY_MIME)!!
      decoder = MediaCodec.createDecoderByType(mime)
      decoder.configure(format, renderer.decoderSurface, null, 0)
      decoder.start()

      val info = MediaCodec.BufferInfo()
      var sawInputEOS = false
      var sawOutputEOS = false
      var firstPts = -1L

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
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
            sawOutputEOS = true
          }
          val pts = info.presentationTimeUs
          val render = info.size > 0 && pts in inUs..outUs
          if (info.size > 0 && pts > outUs) {
            // past the out-point — done with this segment
            decoder.releaseOutputBuffer(outIdx, false)
            sawOutputEOS = true
          } else {
            decoder.releaseOutputBuffer(outIdx, render)
            if (render) {
              if (firstPts < 0) firstPts = pts
              val outUsTimeline = timelineStartUs + (pts - firstPts)
              renderer.awaitNewImage()
              if (blurredFill) renderer.drawBlurredFillFrame(outW, outH) else renderer.drawFrame(outW, outH)
              renderer.setPresentationTime(outUsTimeline * 1000)
              renderer.swapBuffers()
              lastOutUs = outUsTimeline
              drainEncoder(encoder, muxState, encInfo, endOfStream = false)
            }
          }
        }
      }
    } finally {
      try { decoder?.stop() } catch (_: Exception) {}
      try { decoder?.release() } catch (_: Exception) {}
      extractor.release()
    }
    // next segment starts one frame after the last rendered frame
    return lastOutUs + (1_000_000L / FPS)
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
        // keep waiting for EOS
      } else if (outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
        if (muxState.started) throw IllegalStateException("format changed twice")
        muxState.videoTrack = muxState.muxer.addTrack(encoder.outputFormat)
        muxState.audio?.let { muxState.audioTrack = muxState.muxer.addTrack(it.format) }
        muxState.muxer.start()
        muxState.started = true
      } else if (outIdx >= 0) {
        val encoded = encoder.getOutputBuffer(outIdx)
          ?: throw IllegalStateException("null encoder output buffer")
        if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) {
          info.size = 0
        }
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
      val w = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: outW
      val h = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: outH
      val rot = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
      val (dw, dh) = if (rot == 90 || rot == 270) Pair(h, w) else Pair(w, h)
      return if (dh != 0) dw.toDouble() / dh.toDouble() else outW.toDouble() / outH.toDouble()
    } finally {
      retriever.release()
    }
  }

  private class MuxState(val muxer: MediaMuxer) {
    var started = false
    var videoTrack = -1
    var audioTrack = -1
    var audio: EncodedAudio? = null
  }

  companion object {
    private const val MIME = "video/avc"
    private const val FPS = 30
    private const val IFRAME_INTERVAL = 1
  }
}
