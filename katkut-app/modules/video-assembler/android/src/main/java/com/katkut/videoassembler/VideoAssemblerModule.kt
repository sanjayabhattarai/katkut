package com.katkut.videoassembler

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class VideoAssemblerException(message: String, cause: Throwable? = null) :
  CodedException(message, cause)

class SegmentRecord : Record {
  @Field var uri: String = ""
  @Field var inSec: Double = 0.0
  @Field var outSec: Double = 0.0
  @Field var muted: Boolean = true
}

class VideoAssemblerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VideoAssembler")

    // Trim+concat segments → one 1080x1920 MP4 at outputPath (a local filesystem path).
    // audioMode: "smart" (per-clip muted flags) | "on" (all audio) | "off" (silent).
    AsyncFunction("assemble") { segments: List<SegmentRecord>, outputPath: String, audioMode: String, resolution: String ->
      val context = appContext.reactContext
        ?: throw VideoAssemblerException("No React context available")
      val path = outputPath.removePrefix("file://")
      val segs = segments.map { Segment(it.uri, it.inSec, it.outSec, it.muted) }
      try {
        Transcoder(context).assemble(segs, path, audioMode, resolution)
      } catch (e: Exception) {
        throw VideoAssemblerException("Assemble failed: ${e.message}", e)
      }
      mapOf("outputPath" to outputPath)
    }

    // Render one still photo into a short H.264 MP4 (video-only) with Ken Burns motion, sized
    // w x h. The result is a normal MP4, so preview + concat/export consume it like a video clip.
    AsyncFunction("renderPhoto") { uri: String, outputPath: String, width: Int, height: Int, durationSec: Double, motionType: String, motionAmount: Double ->
      val context = appContext.reactContext
        ?: throw VideoAssemblerException("No React context available")
      val path = outputPath.removePrefix("file://")
      try {
        PhotoClipEncoder(context).render(uri, path, width, height, durationSec, motionType, motionAmount)
      } catch (e: Exception) {
        throw VideoAssemblerException("Photo render failed: ${e.message}", e)
      }
      mapOf("outputPath" to outputPath)
    }

    // Generate a low-res 720x1280 preview proxy of one source clip (whole clip, audio passed
    // through) at outputPath. Preview-only; export still uses the full-res original.
    AsyncFunction("makeProxy") { uri: String, outputPath: String ->
      val context = appContext.reactContext
        ?: throw VideoAssemblerException("No React context available")
      val path = outputPath.removePrefix("file://")
      try {
        ProxyTranscoder(context).makeProxy(uri, path)
      } catch (e: Exception) {
        throw VideoAssemblerException("Proxy failed: ${e.message}", e)
      }
      mapOf("outputPath" to outputPath)
    }
  }
}
