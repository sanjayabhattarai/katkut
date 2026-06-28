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
}

const SWAP_EPSILON_SEC = 0.06;

/**
 * Controllable single-player EDL preview. Plays trimmed segments in sequence and
 * reports the active segment; the parent can seek to a clip / play / pause via ref.
 * Single player avoids Android hardware-decoder exhaustion (two players freeze on real devices).
 */
const EdlPlayer = forwardRef<EdlPlayerHandle, EdlPlayerProps>(function EdlPlayer(
  { edl, uriByClipId, loop = true, fill = false, onActiveIndexChange, onPlayingChange },
  ref,
) {
  const player = useVideoPlayer(null, (p) => {
    p.timeUpdateEventInterval = 0.1;
    p.loop = false;
  });

  const indexRef = useRef(0);
  const loadingRef = useRef(false);
  const edlRef = useRef(edl);
  edlRef.current = edl;
  const cbRef = useRef({ onActiveIndexChange, onPlayingChange });
  cbRef.current = { onActiveIndexChange, onPlayingChange };

  const load = useCallback(
    async (i: number, play: boolean) => {
      const timeline = edlRef.current.timeline;
      const seg = timeline[i];
      if (!seg) return;
      const uri = uriByClipId.get(seg.clipId);
      if (!uri) return;
      loadingRef.current = true;
      indexRef.current = i;
      cbRef.current.onActiveIndexChange?.(i);
      try {
        player.pause();
        await player.replaceAsync({ uri });
        player.muted = seg.muted;
        player.currentTime = seg.in;
        if (play) player.play();
        else player.pause();
      } catch {
        // superseded by a later load
      } finally {
        loadingRef.current = false;
      }
    },
    [player, uriByClipId],
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
  }, [player, loop, load]);

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
