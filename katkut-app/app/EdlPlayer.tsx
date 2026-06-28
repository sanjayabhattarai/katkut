import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Edl } from '../core';

export interface EdlPlayerHandle {
  /** load segment i; play or pause at its in-point */
  seekToIndex: (index: number, opts?: { play?: boolean }) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
}

export interface EdlPlayerProps {
  edl: Edl;
  uriByClipId: Map<string, string>;
  loop?: boolean;
  /** fill the parent (flex:1) instead of a fixed 9:16 box */
  fill?: boolean;
  /** fired when the currently-playing segment changes (drives the strip's blue border) */
  onActiveIndexChange?: (index: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  /** elapsed position and total length across the whole timeline (seconds) */
  onProgress?: (currentSec: number, totalSec: number) => void;
}

const SWAP_EPSILON_SEC = 0.06;

/**
 * Controllable single-player EDL preview. Plays trimmed segments in sequence and
 * reports the active segment; the parent can seek to a clip / play / pause via ref.
 * Single player avoids Android hardware-decoder exhaustion (two players freeze on real devices).
 */
const EdlPlayer = forwardRef<EdlPlayerHandle, EdlPlayerProps>(function EdlPlayer(
  { edl, uriByClipId, loop = true, fill = false, onActiveIndexChange, onPlayingChange, onProgress },
  ref,
) {
  const player = useVideoPlayer(null, (p) => {
    p.timeUpdateEventInterval = 0.1;
    p.loop = false;
  });

  const indexRef = useRef(0);
  const loadingRef = useRef(false);
  const loadedUriRef = useRef<string | null>(null);
  const edlRef = useRef(edl);
  edlRef.current = edl;
  const cbRef = useRef({ onActiveIndexChange, onPlayingChange, onProgress });
  cbRef.current = { onActiveIndexChange, onPlayingChange, onProgress };

  // global timeline position: elapsed before the current segment + offset inside it
  const reportProgress = useCallback((i: number, currentTime: number) => {
    const timeline = edlRef.current.timeline;
    let before = 0;
    let total = 0;
    for (let k = 0; k < timeline.length; k++) {
      const len = Math.max(0, timeline[k].out - timeline[k].in);
      if (k < i) before += len;
      total += len;
    }
    const seg = timeline[i];
    const within = seg ? Math.min(Math.max(currentTime - seg.in, 0), Math.max(0, seg.out - seg.in)) : 0;
    cbRef.current.onProgress?.(before + within, total);
  }, []);

  const load = useCallback(
    async (i: number, play: boolean) => {
      const timeline = edlRef.current.timeline;
      const seg = timeline[i];
      if (!seg) return;
      const uri = uriByClipId.get(seg.clipId);
      if (!uri) return;
      indexRef.current = i;
      cbRef.current.onActiveIndexChange?.(i);

      // Same source already loaded (e.g. trimming the clip currently shown): just
      // re-seek. Re-loading the identical URI via replaceAsync can hang the Android
      // decoder — leaving loadingRef stuck true — which freezes the preview and
      // makes play() do nothing. So never replaceAsync when the URI is unchanged.
      if (loadedUriRef.current === uri) {
        player.muted = seg.muted;
        player.currentTime = seg.in;
        reportProgress(i, seg.in);
        if (play) player.play();
        else player.pause();
        return;
      }

      loadingRef.current = true;
      try {
        player.pause();
        await player.replaceAsync({ uri });
        loadedUriRef.current = uri;
        player.muted = seg.muted;
        player.currentTime = seg.in;
        reportProgress(i, seg.in);
        if (play) player.play();
        else player.pause();
      } catch {
        // superseded by a later load
      } finally {
        loadingRef.current = false;
      }
    },
    [player, uriByClipId, reportProgress],
  );

  useImperativeHandle(
    ref,
    () => ({
      seekToIndex: (i, opts) => load(i, !!opts?.play),
      play: () => player.play(),
      pause: () => player.pause(),
      togglePlay: () => (player.playing ? player.pause() : player.play()),
    }),
    [load, player],
  );

  // start playback from the top on mount
  useEffect(() => {
    load(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // advance through segments
  useEffect(() => {
    const sub = player.addListener('timeUpdate', (e) => {
      if (loadingRef.current) return;
      const timeline = edlRef.current.timeline;
      const i = indexRef.current;
      const seg = timeline[i];
      if (!seg) return;
      reportProgress(i, e.currentTime);
      if (e.currentTime < seg.out - SWAP_EPSILON_SEC) return;
      const isLast = i >= timeline.length - 1;
      if (isLast) {
        if (loop) load(0, true);
        else player.pause();
      } else {
        load(i + 1, true);
      }
    });
    return () => sub.remove();
  }, [player, loop, load, reportProgress]);

  // report play/pause changes
  useEffect(() => {
    const sub = player.addListener('playingChange', (e) => {
      cbRef.current.onPlayingChange?.(e.isPlaying);
    });
    return () => sub.remove();
  }, [player]);

  return (
    <View style={fill ? styles.fillFrame : styles.frame}>
      <VideoView style={styles.video} player={player} contentFit="contain" nativeControls={false} />
    </View>
  );
});

export default EdlPlayer;

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    aspectRatio: 9 / 16,
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  fillFrame: {
    flex: 1,
    width: '100%',
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  video: {
    width: '100%',
    height: '100%',
  },
});
