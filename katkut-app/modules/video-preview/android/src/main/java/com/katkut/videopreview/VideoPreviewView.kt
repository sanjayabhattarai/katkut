package com.katkut.videopreview

import android.content.Context
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

data class PreviewItem(val uri: String, val inSec: Double, val outSec: Double, val muted: Boolean)

/**
 * Single ExoPlayer fed a native playlist (one MediaItem per EDL segment, each with a
 * ClippingConfiguration from its in/out). Media3 pre-buffers consecutive items on background
 * threads → gapless segment transitions, no per-clip decoder teardown (the freeze the JS
 * replaceAsync approach caused). One player instance, so no dual-player decoder exhaustion.
 */
@OptIn(UnstableApi::class)
class VideoPreviewView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onProgress by EventDispatcher<Map<String, Any>>()
  private val onActiveIndexChange by EventDispatcher<Map<String, Any>>()
  private val onPlayingChange by EventDispatcher<Map<String, Any>>()
  private val onReady by EventDispatcher<Map<String, Any>>()

  private var player: ExoPlayer? = null
  private val playerView = PlayerView(context).apply {
    useController = false
    resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
    setBackgroundColor(Color.BLACK)
  }

  private var items: List<PreviewItem> = emptyList()
  private var clipMs: LongArray = LongArray(0)
  private var loop: Boolean = true
  private var paused: Boolean = false

  private val handler = Handler(Looper.getMainLooper())
  private val ticker = object : Runnable {
    override fun run() {
      emitProgress()
      handler.postDelayed(this, 100)
    }
  }

  init {
    addView(playerView, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
  }

  private fun ensurePlayer() {
    if (player != null) return

    // Tuned to minimise the clip-boundary stall:
    //  - async MediaCodec queueing keeps the decoder fed off the playback thread
    //  - a short bufferForPlayback gets the next clip rendering ASAP
    val renderersFactory = DefaultRenderersFactory(context)
      .forceEnableMediaCodecAsynchronousQueueing()
      .setEnableDecoderFallback(true)
    val loadControl = DefaultLoadControl.Builder()
      .setBufferDurationsMs(30_000, 60_000, 250, 500)
      .build()

    val p = ExoPlayer.Builder(context, renderersFactory)
      .setLoadControl(loadControl)
      // prepare ALL clips up front (not lazily) so the next clip's decoder is ready
      // before its boundary, instead of stalling on the last frame to prepare it
      .setUseLazyPreparation(false)
      .build()
    p.repeatMode = if (loop) Player.REPEAT_MODE_ALL else Player.REPEAT_MODE_OFF
    p.addListener(object : Player.Listener {
      override fun onIsPlayingChanged(isPlaying: Boolean) {
        onPlayingChange(mapOf("isPlaying" to isPlaying))
      }

      override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
        val idx = player?.currentMediaItemIndex ?: 0
        applyMuteForIndex(idx)
        onActiveIndexChange(mapOf("index" to idx))
      }

      override fun onPlaybackStateChanged(state: Int) {
        if (state == Player.STATE_READY) onReady(emptyMap())
      }
    })
    playerView.player = p
    player = p
    rebuildPlaylist(0L)
  }

  fun setTimeline(newItems: List<PreviewItem>) {
    items = newItems
    ensurePlayer()
    rebuildPlaylist(currentGlobalMs())
  }

  private fun rebuildPlaylist(seekToGlobalMs: Long) {
    val p = player ?: return
    clipMs = LongArray(items.size) {
      (((items[it].outSec - items[it].inSec) * 1000).toLong()).coerceAtLeast(0L)
    }
    val mediaItems = items.map { seg ->
      MediaItem.Builder()
        .setUri(seg.uri)
        .setClippingConfiguration(
          MediaItem.ClippingConfiguration.Builder()
            .setStartPositionMs((seg.inSec * 1000).toLong())
            .setEndPositionMs((seg.outSec * 1000).toLong())
            .build(),
        )
        .build()
    }
    p.setMediaItems(mediaItems)
    p.prepare()
    p.playWhenReady = !paused
    seekToGlobal(seekToGlobalMs)
    applyMuteForIndex(p.currentMediaItemIndex)
  }

  private fun applyMuteForIndex(idx: Int) {
    val muted = items.getOrNull(idx)?.muted ?: false
    player?.volume = if (muted) 0f else 1f
  }

  private fun currentGlobalMs(): Long {
    val p = player ?: return 0L
    val idx = p.currentMediaItemIndex
    var acc = 0L
    for (i in 0 until idx) acc += clipMs.getOrElse(i) { 0L }
    return acc + p.currentPosition.coerceAtLeast(0L)
  }

  private fun totalMs(): Long = clipMs.sum()

  private fun emitProgress() {
    onProgress(
      mapOf(
        "currentSec" to currentGlobalMs() / 1000.0,
        "totalSec" to totalMs() / 1000.0,
      ),
    )
  }

  // map a global timeline position (ms) → (window index, position within that window)
  private fun seekToGlobal(globalMs: Long) {
    val p = player ?: return
    if (clipMs.isEmpty()) return
    var remaining = globalMs.coerceAtLeast(0L)
    var idx = 0
    while (idx < clipMs.size && remaining > clipMs[idx]) {
      remaining -= clipMs[idx]
      idx++
    }
    if (idx >= clipMs.size) {
      idx = clipMs.size - 1
      remaining = clipMs[idx]
    }
    p.seekTo(idx, remaining)
  }

  fun seekToTimeSec(sec: Double) {
    seekToGlobal((sec * 1000).toLong())
    emitProgress()
  }

  fun setLoop(value: Boolean) {
    loop = value
    player?.repeatMode = if (value) Player.REPEAT_MODE_ALL else Player.REPEAT_MODE_OFF
  }

  fun setPaused(value: Boolean) {
    paused = value
    player?.playWhenReady = !value
  }

  fun playNow() {
    paused = false
    player?.playWhenReady = true
  }

  fun pauseNow() {
    paused = true
    player?.playWhenReady = false
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    ensurePlayer()
    handler.removeCallbacks(ticker)
    handler.post(ticker)
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    handler.removeCallbacks(ticker)
    playerView.player = null
    player?.release()
    player = null
  }
}
