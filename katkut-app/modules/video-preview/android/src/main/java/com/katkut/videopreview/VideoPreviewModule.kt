package com.katkut.videopreview

import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class PreviewItemRecord : Record {
  @Field var uri: String = ""
  @Field var inSec: Double = 0.0
  @Field var outSec: Double = 0.0
  @Field var muted: Boolean = false
}

@OptIn(UnstableApi::class)
class VideoPreviewModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VideoPreview")

    View(VideoPreviewView::class) {
      Events("onProgress", "onActiveIndexChange", "onPlayingChange", "onReady")

      Prop("timeline") { view: VideoPreviewView, items: List<PreviewItemRecord> ->
        view.setTimeline(items.map { PreviewItem(it.uri, it.inSec, it.outSec, it.muted) })
      }
      Prop("loop") { view: VideoPreviewView, value: Boolean -> view.setLoop(value) }
      Prop("paused") { view: VideoPreviewView, value: Boolean -> view.setPaused(value) }

      AsyncFunction("play") { view: VideoPreviewView -> view.playNow() }.runOnQueue(Queues.MAIN)
      AsyncFunction("pause") { view: VideoPreviewView -> view.pauseNow() }.runOnQueue(Queues.MAIN)
      AsyncFunction("seekToTime") { view: VideoPreviewView, sec: Double ->
        view.seekToTimeSec(sec)
      }.runOnQueue(Queues.MAIN)
    }
  }
}
