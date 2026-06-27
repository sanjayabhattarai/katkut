package com.katkut.videoanalysis

import android.content.Context
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.media.Image
import android.net.Uri
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.min
import kotlin.math.sqrt

class VideoAnalysisException(message: String, cause: Throwable? = null) :
  CodedException(message, cause)

// One sampled frame's video metrics.
private data class Sample(
  val tSec: Double,
  val blur: Double,
  val exposure: Double,
  val frozen: Boolean,
)

class VideoAnalysisModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VideoAnalysis")

    // Single-pass video analysis. Audio (audioRMS) is filled by a separate pass in Slice 1C-2;
    // here it is a placeholder so the JSON already conforms to the core/ AnalysisClip schema.
    AsyncFunction("analyze") { uri: String, clipId: String ->
      val context = appContext.reactContext
        ?: throw VideoAnalysisException("No React context available")
      analyzeVideo(context, uri, clipId)
    }
  }
}

// ---- tunables (validation will tune these in Phase 2) ----
private const val SAMPLE_INTERVAL_US = 250_000L // ~4 fps
private const val GRID_MAX = 96 // downsample target for cheap luma math
private const val WINDOW_SEC = 1.0
private const val FREEZE_DIFF = 2.0 // mean abs luma diff below this => frozen
private const val SCENE_DIFF = 30.0 // above this => scene cut
private const val SHARP_REF = 300.0 // Laplacian variance treated as "fully sharp"
private const val SILENCE_DBFS = -120.0 // window with no audio samples / no audio track

private fun clamp01(x: Double): Double = if (x < 0.0) 0.0 else if (x > 1.0) 1.0 else x

private fun classifyOrientation(w: Int, h: Int): String {
  if (w == 0 || h == 0) return "portrait"
  val ratio = w.toDouble() / h.toDouble()
  return when {
    ratio in 0.95..1.05 -> "square"
    ratio < 0.95 -> "portrait"
    else -> "landscape"
  }
}

private fun analyzeVideo(context: Context, uri: String, clipId: String): Map<String, Any> {
  val parsed = Uri.parse(uri)

  // --- duration + orientation (cheap metadata) ---
  val retriever = MediaMetadataRetriever()
  var durationSec: Double
  var orientation: String
  try {
    retriever.setDataSource(context, parsed)
    val durationMs =
      retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
    durationSec = durationMs / 1000.0
    val w = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
    val h = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
    val rot = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
    val (ow, oh) = if (rot == 90 || rot == 270) Pair(h, w) else Pair(w, h)
    orientation = classifyOrientation(ow, oh)
  } finally {
    retriever.release()
  }

  // --- decode video track once, sampling frames ---
  val extractor = MediaExtractor()
  val samples = ArrayList<Sample>()
  val sceneCuts = ArrayList<Double>()
  var codec: MediaCodec? = null
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
    if (trackIndex < 0 || format == null) {
      throw VideoAnalysisException("No video track found in $uri")
    }
    extractor.selectTrack(trackIndex)
    val mime = format.getString(MediaFormat.KEY_MIME)!!
    format.setInteger(
      MediaFormat.KEY_COLOR_FORMAT,
      MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible,
    )

    codec = MediaCodec.createDecoderByType(mime)
    codec.configure(format, null, null, 0)
    codec.start()

    val info = MediaCodec.BufferInfo()
    var sawInputEOS = false
    var sawOutputEOS = false
    var nextSampleUs = 0L
    var prevGrid: IntArray? = null
    var prevGw = 0
    var prevGh = 0

    while (!sawOutputEOS) {
      if (!sawInputEOS) {
        val inIdx = codec.dequeueInputBuffer(10_000)
        if (inIdx >= 0) {
          val inBuf = codec.getInputBuffer(inIdx)
          val size = if (inBuf != null) extractor.readSampleData(inBuf, 0) else -1
          if (size < 0) {
            codec.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
            sawInputEOS = true
          } else {
            val pts = extractor.sampleTime
            codec.queueInputBuffer(inIdx, 0, size, pts, 0)
            extractor.advance()
          }
        }
      }

      val outIdx = codec.dequeueOutputBuffer(info, 10_000)
      if (outIdx >= 0) {
        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
          sawOutputEOS = true
        }
        val shouldSample = info.size > 0 && info.presentationTimeUs >= nextSampleUs
        if (shouldSample) {
          val image = codec.getOutputImage(outIdx)
          if (image != null) {
            val (grid, gw, gh) = lumaGrid(image)
            image.close()

            val exposure = grid.average() / 255.0
            val blur = blurFromGrid(grid, gw, gh)

            var frozen = false
            val tSec = info.presentationTimeUs / 1_000_000.0
            val prev = prevGrid
            if (prev != null && prevGw == gw && prevGh == gh) {
              val meanDiff = meanAbsDiff(grid, prev)
              frozen = meanDiff < FREEZE_DIFF
              if (meanDiff > SCENE_DIFF) sceneCuts.add(round1(tSec))
            }
            samples.add(Sample(tSec, blur, exposure, frozen))
            prevGrid = grid
            prevGw = gw
            prevGh = gh
            nextSampleUs = info.presentationTimeUs + SAMPLE_INTERVAL_US
          }
        }
        codec.releaseOutputBuffer(outIdx, false)
      }
    }
  } finally {
    try { codec?.stop() } catch (_: Exception) {}
    try { codec?.release() } catch (_: Exception) {}
    extractor.release()
  }

  if (durationSec <= 0.0 && samples.isNotEmpty()) {
    durationSec = samples.last().tSec + WINDOW_SEC
  }

  // --- audio pass (secondary signal; never fails the whole analysis) ---
  val audioByWindow = try {
    audioRmsByWindow(context, parsed)
  } catch (_: Exception) {
    emptyMap()
  }

  val windows = buildWindows(samples, durationSec, audioByWindow)

  return mapOf(
    "clipId" to clipId,
    "duration" to round1(durationSec),
    "orientation" to orientation,
    "sceneCuts" to sceneCuts,
    "windows" to windows,
    "uri" to uri,
  )
}

// Downsample the Y (luma) plane to a small grid for cheap math.
private fun lumaGrid(image: Image): Triple<IntArray, Int, Int> {
  val plane = image.planes[0]
  val buf = plane.buffer
  val rowStride = plane.rowStride
  val pixStride = plane.pixelStride
  val width = image.width
  val height = image.height
  val gw = min(GRID_MAX, width).coerceAtLeast(1)
  val gh = min(GRID_MAX, height).coerceAtLeast(1)
  val out = IntArray(gw * gh)
  for (gy in 0 until gh) {
    val sy = gy * height / gh
    for (gx in 0 until gw) {
      val sx = gx * width / gw
      val idx = sy * rowStride + sx * pixStride
      out[gy * gw + gx] = buf.get(idx).toInt() and 0xFF
    }
  }
  return Triple(out, gw, gh)
}

// Laplacian variance → blurriness in 0..1 (1 = very blurry).
private fun blurFromGrid(grid: IntArray, gw: Int, gh: Int): Double {
  if (gw < 3 || gh < 3) return 0.0
  var sum = 0.0
  var sumSq = 0.0
  var n = 0
  for (y in 1 until gh - 1) {
    for (x in 1 until gw - 1) {
      val c = grid[y * gw + x]
      val lap = 4 * c - grid[(y - 1) * gw + x] - grid[(y + 1) * gw + x] -
        grid[y * gw + (x - 1)] - grid[y * gw + (x + 1)]
      sum += lap
      sumSq += (lap * lap).toDouble()
      n++
    }
  }
  if (n == 0) return 0.0
  val mean = sum / n
  val variance = sumSq / n - mean * mean
  return clamp01(1.0 - variance / SHARP_REF)
}

private fun meanAbsDiff(a: IntArray, b: IntArray): Double {
  var d = 0.0
  val n = min(a.size, b.size)
  if (n == 0) return 0.0
  for (i in 0 until n) d += abs(a[i] - b[i])
  return d / n
}

private fun buildWindows(
  samples: List<Sample>,
  durationSec: Double,
  audioByWindow: Map<Int, Double>,
): List<Map<String, Any>> {
  if (samples.isEmpty()) return emptyList()
  val byWindow = HashMap<Int, MutableList<Sample>>()
  for (s in samples) {
    val idx = floor(s.tSec / WINDOW_SEC).toInt()
    byWindow.getOrPut(idx) { ArrayList() }.add(s)
  }
  val result = ArrayList<Map<String, Any>>()
  for (idx in byWindow.keys.sorted()) {
    val group = byWindow[idx]!!
    val blur = group.map { it.blur }.average()
    val exposure = group.map { it.exposure }.average()
    val frozenCount = group.count { it.frozen }
    val frozen = frozenCount * 2 > group.size
    val start = idx * WINDOW_SEC
    val end = if (durationSec > 0) min((idx + 1) * WINDOW_SEC, durationSec) else (idx + 1) * WINDOW_SEC
    result.add(
      mapOf(
        "start" to round1(start),
        "end" to round1(end),
        "blur" to round3(blur),
        "audioRMS" to round1(audioByWindow[idx] ?: SILENCE_DBFS),
        "exposure" to round3(exposure),
        "frozen" to frozen,
      ),
    )
  }
  return result
}

// Decode the audio track once → per-window RMS loudness in dBFS.
private fun audioRmsByWindow(context: Context, uri: Uri): Map<Int, Double> {
  val extractor = MediaExtractor()
  var codec: MediaCodec? = null
  val sumSq = HashMap<Int, Double>()
  val count = HashMap<Int, Long>()
  try {
    extractor.setDataSource(context, uri, null)
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
    if (trackIndex < 0 || format == null) return emptyMap() // no audio track (silent clip)
    extractor.selectTrack(trackIndex)
    val mime = format.getString(MediaFormat.KEY_MIME)!!
    codec = MediaCodec.createDecoderByType(mime)
    codec.configure(format, null, null, 0)
    codec.start()

    val info = MediaCodec.BufferInfo()
    var sawInputEOS = false
    var sawOutputEOS = false

    while (!sawOutputEOS) {
      if (!sawInputEOS) {
        val inIdx = codec.dequeueInputBuffer(10_000)
        if (inIdx >= 0) {
          val inBuf = codec.getInputBuffer(inIdx)
          val size = if (inBuf != null) extractor.readSampleData(inBuf, 0) else -1
          if (size < 0) {
            codec.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
            sawInputEOS = true
          } else {
            codec.queueInputBuffer(inIdx, 0, size, extractor.sampleTime, 0)
            extractor.advance()
          }
        }
      }

      val outIdx = codec.dequeueOutputBuffer(info, 10_000)
      if (outIdx >= 0) {
        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) sawOutputEOS = true
        if (info.size > 0) {
          val outBuf = codec.getOutputBuffer(outIdx)
          if (outBuf != null) {
            val idx = floor(info.presentationTimeUs / 1_000_000.0 / WINDOW_SEC).toInt()
            val shorts = outBuf.order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
            var localSq = 0.0
            var localN = 0L
            while (shorts.hasRemaining()) {
              val s = shorts.get().toDouble()
              localSq += s * s
              localN++
            }
            sumSq[idx] = (sumSq[idx] ?: 0.0) + localSq
            count[idx] = (count[idx] ?: 0L) + localN
          }
        }
        codec.releaseOutputBuffer(outIdx, false)
      }
    }
  } finally {
    try { codec?.stop() } catch (_: Exception) {}
    try { codec?.release() } catch (_: Exception) {}
    extractor.release()
  }

  val result = HashMap<Int, Double>()
  for (idx in sumSq.keys) {
    val n = count[idx] ?: 0L
    if (n <= 0L) continue
    val rms = sqrt(sumSq[idx]!! / n)
    val dbfs = if (rms > 0.0) 20.0 * log10(rms / 32768.0) else SILENCE_DBFS
    result[idx] = if (dbfs < SILENCE_DBFS) SILENCE_DBFS else dbfs
  }
  return result
}

private fun round1(x: Double): Double = Math.round(x * 10.0) / 10.0
private fun round3(x: Double): Double = Math.round(x * 1000.0) / 1000.0
