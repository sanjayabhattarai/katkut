import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import VideoPreviewView, { VideoPreviewHandle, VideoPreviewItem } from '../modules/video-preview';
import { Edl } from '../core';

export interface EdlPlayerHandle {
  /** load segment i; play or pause at its in-point */
  seekToIndex: (index: number, opts?: { play?: boolean }) => void;
  /** seek to an exact position in the whole edited timeline (seconds) */
  scrubTo: (globalSec: number) => void;
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

/**
 * EDL preview backed by the native Media3 player module: the EDL becomes a single ExoPlayer
 * playlist of clipped MediaItems, so segment transitions are gapless and pre-buffered natively
 * (no per-clip decoder teardown, no dual-player decoder exhaustion). This component just maps
 * the EDL → playlist items and forwards imperative play/seek to the native view.
 */
const EdlPlayer = forwardRef<EdlPlayerHandle, EdlPlayerProps>(function EdlPlayer(
  { edl, uriByClipId, loop = true, fill = false, onActiveIndexChange, onPlayingChange, onProgress },
  ref,
) {
  const viewRef = useRef<VideoPreviewHandle>(null);
  const playingRef = useRef(false);

  const items = useMemo<VideoPreviewItem[]>(
    () =>
      edl.timeline.flatMap((t) => {
        const uri = uriByClipId.get(t.clipId);
        if (!uri) return [];
        // A photo plays only via its rendered .mp4 clip (still + motion). If we only resolved the
        // raw image (e.g. a reopened draft before proxies exist), skip it rather than feed the
        // video player an image it can't decode.
        if (t.kind === 'photo' && !uri.endsWith('.mp4')) return [];
        return [{ uri, inSec: t.in, outSec: t.out, muted: t.muted }];
      }),
    [edl, uriByClipId],
  );

  // start-of-segment positions in the global timeline, for seekToIndex
  const startsSec = useMemo(() => {
    const arr: number[] = [];
    let acc = 0;
    for (const t of edl.timeline) {
      arr.push(acc);
      acc += Math.max(0, t.out - t.in);
    }
    return arr;
  }, [edl]);

  useImperativeHandle(
    ref,
    () => ({
      seekToIndex: (i, opts) => {
        viewRef.current?.seekToTime(startsSec[i] ?? 0);
        if (opts?.play) viewRef.current?.play();
        else viewRef.current?.pause();
      },
      scrubTo: (sec) => viewRef.current?.seekToTime(sec),
      play: () => viewRef.current?.play(),
      pause: () => viewRef.current?.pause(),
      togglePlay: () =>
        playingRef.current ? viewRef.current?.pause() : viewRef.current?.play(),
    }),
    [startsSec],
  );

  return (
    <View style={fill ? styles.fillFrame : styles.frame}>
      <VideoPreviewView
        ref={viewRef}
        style={styles.video}
        timeline={items}
        loop={loop}
        onActiveIndexChange={onActiveIndexChange}
        onPlayingChange={(p) => {
          playingRef.current = p;
          onPlayingChange?.(p);
        }}
        onProgress={(e) => onProgress?.(e.currentSec, e.totalSec)}
      />
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
