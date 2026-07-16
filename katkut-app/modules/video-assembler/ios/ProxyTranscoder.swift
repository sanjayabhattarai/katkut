import AVFoundation
import CoreImage

// Generate a low-res PREVIEW PROXY of one source clip: the whole clip, downscaled to a uniform
// 720x1280 (9:16) H.264 frame (same cover/blurred-fill scale the exporter uses), with audio
// passed through unmodified (remuxed, not re-encoded) — mirrors ProxyTranscoder.kt.
//
// Why: the preview player concatenates clips on a single player. Mixed source resolutions force
// reconfiguration at each clip boundary → a visible stall. Rendering every clip to ONE uniform
// proxy format keeps it gapless. Proxies are throwaway (preview only); export uses the originals.
final class ProxyTranscoder {
  private static let outW = 720
  private static let outH = 1280
  private static let bitrate = 4_000_000
  private static let fps = 30

  func makeProxy(uri: String, outputPath: String) throws {
    guard let url = URL(string: uri) else { throw VideoAssemblerException("Bad URI: \(uri)") }
    let asset = AVURLAsset(url: url)
    guard let track = asset.tracks(withMediaType: .video).first else {
      throw VideoAssemblerException("No video track in \(uri)")
    }

    // Same blurred-fill rule as export (HARD RULE 2) so preview matches the final render exactly.
    let transform = track.preferredTransform
    let displayRect = CGRect(origin: .zero, size: track.naturalSize).applying(transform)
    let displaySize = CGSize(width: abs(displayRect.width), height: abs(displayRect.height))
    let srcAspect = Double(displaySize.width / displaySize.height)
    let dstAspect = Double(Self.outW) / Double(Self.outH)
    let blurredFill = srcAspect > dstAspect
    let dstSize = CGSize(width: Self.outW, height: Self.outH)
    let containRect = blurredFill ? FrameCompositor.containFitRect(srcSize: displaySize, dstSize: dstSize) : .zero

    let writer = try VideoEncoderWriter(
      outputPath: outputPath, width: Self.outW, height: Self.outH, bitrate: Self.bitrate, fps: Self.fps,
      keyframeIntervalSec: 0, allKeyframes: true
    )

    // audio is passed through (remuxed, not re-encoded) — add the input before start() so its
    // (passthrough) format is known up front, same reasoning as Android's early track-add.
    var audioInput: AVAssetWriterInput?
    var audioReader: AVAssetReader?
    var audioReaderOutput: AVAssetReaderTrackOutput?
    if let audioTrack = asset.tracks(withMediaType: .audio).first {
      // BUG FIX: without a sourceFormatHint, AVAssetWriter can't validate a passthrough
      // (outputSettings: nil) audio format against the .mp4 container up front, so canAdd(_:)
      // conservatively returns false for every clip regardless of its actual source codec —
      // matching the observed 100% proxy-generation failure rate ("Cannot add audio input to
      // writer"). Passing the source track's own format description lets AVAssetWriter validate
      // it correctly instead of guessing.
      let formatHint = audioTrack.formatDescriptions.first as! CMFormatDescription?
      let input = AVAssetWriterInput(mediaType: .audio, outputSettings: nil, sourceFormatHint: formatHint)
      input.expectsMediaDataInRealTime = false
      try writer.addAudioInput(input)
      audioInput = input

      let reader = try AVAssetReader(asset: asset)
      let output = AVAssetReaderTrackOutput(track: audioTrack, outputSettings: nil)
      output.alwaysCopiesSampleData = false
      if reader.canAdd(output) {
        reader.add(output)
        audioReader = reader
        audioReaderOutput = output
      }
    }

    try writer.start()

    // AVAssetWriter interleaves multiple tracks by presentation time internally, and throttles
    // isReadyForMoreMediaData on one track while waiting for the other to catch up. Writing 100%
    // of the video track before starting audio (or vice versa) deadlocks once that internal buffer
    // window fills — both tracks must be fed concurrently.
    var videoError: Error?
    let group = DispatchGroup()

    group.enter()
    DispatchQueue.global(qos: .userInitiated).async {
      do {
        // --- transcode the whole video track, downscaled via CoreImage ---
        let videoReader = try AVAssetReader(asset: asset)
        let videoOutput = AVAssetReaderTrackOutput(
          track: track, outputSettings: FrameCompositor.videoReaderOutputSettings
        )
        videoOutput.alwaysCopiesSampleData = false
        guard videoReader.canAdd(videoOutput) else {
          throw VideoAssemblerException("Cannot read video track for \(uri)")
        }
        videoReader.add(videoOutput)
        guard videoReader.startReading() else {
          throw VideoAssemblerException(
            "Failed to start reading \(uri): \(videoReader.error?.localizedDescription ?? "unknown error")"
          )
        }

        var firstPts: CMTime?
        while let sampleBuffer = videoOutput.copyNextSampleBuffer() {
          // See Transcoder.transcodeSegment — drain per-frame or autoreleased pixel buffers pile
          // up for the whole clip instead of being freed frame-by-frame.
          autoreleasepool {
            guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
            let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
            if firstPts == nil { firstPts = pts }

            let oriented = FrameCompositor.orientedImage(pixelBuffer: pixelBuffer, transform: transform)
            var composited: CIImage
            if blurredFill {
              let background = FrameCompositor.blurredFillBackground(oriented, dstSize: dstSize)
              let foreground = FrameCompositor.placed(oriented, in: containRect)
              composited = foreground.composited(over: background)
            } else {
              composited = FrameCompositor.scaledToFill(
                FrameCompositor.coverCropped(oriented, dstAspect: dstAspect), dstSize: dstSize
              )
            }

            guard let outPixelBuffer = writer.makePixelBuffer() else { return }
            FrameCompositor.render(composited, to: outPixelBuffer)
            writer.append(outPixelBuffer, at: CMTimeSubtract(pts, firstPts!))
          }
        }
        if videoReader.status == .failed {
          throw VideoAssemblerException(
            "Decoding failed for \(uri): \(videoReader.error?.localizedDescription ?? "unknown error")"
          )
        }
      } catch {
        videoError = error
      }
      writer.finishVideoInput()
      group.leave()
    }

    // --- copy the audio track through, unmodified, concurrently with the video queue above ---
    if let audioInput, let audioReaderOutput, let audioReader {
      group.enter()
      DispatchQueue.global(qos: .userInitiated).async {
        if audioReader.startReading() {
          while let sampleBuffer = audioReaderOutput.copyNextSampleBuffer() {
            autoreleasepool {
              while !audioInput.isReadyForMoreMediaData {
                Thread.sleep(forTimeInterval: 0.001)
              }
              audioInput.append(sampleBuffer)
            }
          }
        }
        audioInput.markAsFinished()
        group.leave()
      }
    } else {
      audioInput?.markAsFinished()
    }

    group.wait()
    if let videoError { throw videoError }

    try writer.finishSync()
  }
}
