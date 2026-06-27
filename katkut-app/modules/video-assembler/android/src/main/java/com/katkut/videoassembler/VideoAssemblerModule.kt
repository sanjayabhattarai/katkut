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
}

class VideoAssemblerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VideoAssembler")

    // Trim+concat segments → one 1080x1920 MP4 at outputPath (a local filesystem path).
    AsyncFunction("assemble") { segments: List<SegmentRecord>, outputPath: String ->
      val context = appContext.reactContext
        ?: throw VideoAssemblerException("No React context available")
      val path = outputPath.removePrefix("file://")
      val segs = segments.map { Segment(it.uri, it.inSec, it.outSec) }
      try {
        Transcoder(context).assemble(segs, path)
      } catch (e: Exception) {
        throw VideoAssemblerException("Assemble failed: ${e.message}", e)
      }
      mapOf("outputPath" to outputPath)
    }
  }
}
