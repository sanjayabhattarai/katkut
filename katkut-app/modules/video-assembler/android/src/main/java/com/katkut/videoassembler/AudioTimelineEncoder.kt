package com.katkut.videoassembler

import android.content.Context
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** One encoded AAC access unit plus its timestamp. */
class AacPacket(val data: ByteArray, val ptsUs: Long, val flags: Int)

class EncodedAudio(val format: MediaFormat, val packets: List<AacPacket>)

/**
 * Builds one continuous audio track for the whole timeline at a fixed format
 * (44.1kHz stereo): source audio for un-muted segments, silence for muted ones.
 * Source audio is decoded → resampled/remixed to the fixed format → re-encoded to AAC.
 */
class AudioTimelineEncoder(private val context: Context) {

  fun encode(segments: List<Segment>): EncodedAudio {
    val pcm = ByteArrayOutputStream()
    for (seg in segments) {
      val durUs = ((seg.outSec - seg.inSec) * 1_000_000).toLong().coerceAtLeast(0)
      if (seg.muted) {
        appendSilence(pcm, durUs)
      } else {
        appendSegmentPcm(pcm, seg, durUs)
      }
    }
    return encodeAac(pcm.toByteArray())
  }

  private fun appendSilence(out: ByteArrayOutputStream, durUs: Long) {
    val frames = (durUs * OUT_RATE / 1_000_000L).toInt()
    val bytes = ByteArray(frames * OUT_CHANNELS * 2) // zeros
    out.write(bytes)
  }

  private fun appendSegmentPcm(out: ByteArrayOutputStream, seg: Segment, durUs: Long) {
    val parsed = Uri.parse(seg.uri)
    val inUs = (seg.inSec * 1_000_000).toLong()
    val outUs = (seg.outSec * 1_000_000).toLong()

    val extractor = MediaExtractor()
    var decoder: MediaCodec? = null
    val srcBytes = ByteArrayOutputStream()
    var srcRate = OUT_RATE
    var srcChannels = OUT_CHANNELS
    try {
      extractor.setDataSource(context, parsed, null)
      var trackIndex = -1
      var format: MediaFormat? = null
      for (i in 0 until extractor.trackCount) {
        val f = extractor.getTrackFormat(i)
        val mime = f.getString(MediaFormat.KEY_MIME) ?: continue
        if (mime.startsWith("audio/")) {
          trackIndex = i
          format = f
          break
        }
      }
      if (trackIndex < 0 || format == null) {
        appendSilence(out, durUs) // no audio track → silence
        return
      }
      srcRate = if (format.containsKey(MediaFormat.KEY_SAMPLE_RATE)) format.getInteger(MediaFormat.KEY_SAMPLE_RATE) else OUT_RATE
      srcChannels = if (format.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) format.getInteger(MediaFormat.KEY_CHANNEL_COUNT) else OUT_CHANNELS

      extractor.selectTrack(trackIndex)
      extractor.seekTo(inUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
      val mime = format.getString(MediaFormat.KEY_MIME)!!
      decoder = MediaCodec.createDecoderByType(mime)
      decoder.configure(format, null, null, 0)
      decoder.start()

      val info = MediaCodec.BufferInfo()
      var sawInputEOS = false
      var sawOutputEOS = false
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
          val pts = info.presentationTimeUs
          if (info.size > 0 && pts >= inUs && pts <= outUs) {
            val buf = decoder.getOutputBuffer(outIdx)
            if (buf != null) {
              val chunk = ByteArray(info.size)
              buf.position(info.offset)
              buf.get(chunk, 0, info.size)
              srcBytes.write(chunk)
            }
          }
          decoder.releaseOutputBuffer(outIdx, false)
          if (info.size > 0 && pts > outUs) sawOutputEOS = true
        }
      }
    } finally {
      try { decoder?.stop() } catch (_: Exception) {}
      try { decoder?.release() } catch (_: Exception) {}
      extractor.release()
    }

    val resampled = resampleToStereo(srcBytes.toByteArray(), srcRate, srcChannels)
    out.write(resampled)
  }

  /** Convert interleaved 16-bit PCM (srcChannels @ srcRate) → interleaved stereo 16-bit @ OUT_RATE. */
  private fun resampleToStereo(src: ByteArray, srcRate: Int, srcChannels: Int): ByteArray {
    if (src.isEmpty() || srcChannels <= 0) return ByteArray(0)
    val shorts = ByteBuffer.wrap(src).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
    val totalSamples = shorts.remaining()
    val srcFrames = totalSamples / srcChannels
    if (srcFrames == 0) return ByteArray(0)

    // to stereo float
    val left = FloatArray(srcFrames)
    val right = FloatArray(srcFrames)
    for (i in 0 until srcFrames) {
      val base = i * srcChannels
      val l = shorts.get(base).toFloat()
      val r = if (srcChannels >= 2) shorts.get(base + 1).toFloat() else l
      left[i] = l
      right[i] = r
    }

    val outFrames = if (srcRate == OUT_RATE) srcFrames
    else Math.round(srcFrames.toLong() * OUT_RATE / srcRate.toDouble()).toInt()
    val out = ByteBuffer.allocate(outFrames * OUT_CHANNELS * 2).order(ByteOrder.LITTLE_ENDIAN)
    for (i in 0 until outFrames) {
      val srcPos = if (srcRate == OUT_RATE) i.toDouble() else i.toDouble() * srcRate / OUT_RATE
      val i0 = srcPos.toInt().coerceIn(0, srcFrames - 1)
      val i1 = (i0 + 1).coerceAtMost(srcFrames - 1)
      val frac = (srcPos - i0).toFloat()
      val l = left[i0] + (left[i1] - left[i0]) * frac
      val r = right[i0] + (right[i1] - right[i0]) * frac
      out.putShort(l.toInt().coerceIn(-32768, 32767).toShort())
      out.putShort(r.toInt().coerceIn(-32768, 32767).toShort())
    }
    return out.array()
  }

  private fun encodeAac(pcm: ByteArray): EncodedAudio {
    val format = MediaFormat.createAudioFormat(MIME_AAC, OUT_RATE, OUT_CHANNELS).apply {
      setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
      setInteger(MediaFormat.KEY_BIT_RATE, AAC_BITRATE)
      setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 64 * 1024)
    }
    val encoder = MediaCodec.createEncoderByType(MIME_AAC)
    encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    encoder.start()

    val packets = ArrayList<AacPacket>()
    var outFormat: MediaFormat? = null
    val info = MediaCodec.BufferInfo()
    val bytesPerFrame = OUT_CHANNELS * 2
    var offset = 0
    var sawInputEOS = false
    var sawOutputEOS = false

    try {
      while (!sawOutputEOS) {
        if (!sawInputEOS) {
          val inIdx = encoder.dequeueInputBuffer(10_000)
          if (inIdx >= 0) {
            val inBuf = encoder.getInputBuffer(inIdx)!!
            inBuf.clear()
            val remaining = pcm.size - offset
            val chunk = minOf(inBuf.capacity(), remaining)
            val ptsUs = (offset / bytesPerFrame).toLong() * 1_000_000L / OUT_RATE
            if (chunk > 0) inBuf.put(pcm, offset, chunk)
            offset += chunk
            // Queue each input index exactly once; flag EOS on the final buffer.
            val eos = offset >= pcm.size
            val flags = if (eos) MediaCodec.BUFFER_FLAG_END_OF_STREAM else 0
            encoder.queueInputBuffer(inIdx, 0, chunk, ptsUs, flags)
            if (eos) sawInputEOS = true
          }
        }
        val outIdx = encoder.dequeueOutputBuffer(info, 10_000)
        if (outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
          outFormat = encoder.outputFormat
        } else if (outIdx >= 0) {
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) sawOutputEOS = true
          val buf = encoder.getOutputBuffer(outIdx)
          if (buf != null && info.size > 0 && info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0) {
            val data = ByteArray(info.size)
            buf.position(info.offset)
            buf.get(data, 0, info.size)
            packets.add(AacPacket(data, info.presentationTimeUs, info.flags))
          }
          encoder.releaseOutputBuffer(outIdx, false)
        }
      }
    } finally {
      try { encoder.stop() } catch (_: Exception) {}
      try { encoder.release() } catch (_: Exception) {}
    }

    val finalFormat = outFormat ?: format
    return EncodedAudio(finalFormat, packets)
  }

  companion object {
    private const val MIME_AAC = "audio/mp4a-latm"
    private const val OUT_RATE = 44100
    private const val OUT_CHANNELS = 2
    private const val AAC_BITRATE = 128_000
  }
}
