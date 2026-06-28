import { requireNativeView } from 'expo';
import { forwardRef, useImperativeHandle, useRef } from 'react';
import { StyleProp, ViewStyle } from 'react-native';

/** One EDL segment: a source clip trimmed to [inSec, outSec], optionally muted. */
export interface VideoPreviewItem {
  uri: string;
  inSec: number;
  outSec: number;
  muted: boolean;
}

export interface VideoPreviewProps {
  timeline: VideoPreviewItem[];
  loop?: boolean;
  paused?: boolean;
  style?: StyleProp<ViewStyle>;
  /** elapsed/total seconds across the whole edited timeline */
  onProgress?: (e: { currentSec: number; totalSec: number }) => void;
  /** the playing segment changed (drives the strip's active highlight) */
  onActiveIndexChange?: (index: number) => void;
  onPlayingChange?: (isPlaying: boolean) => void;
  onReady?: () => void;
}

export interface VideoPreviewHandle {
  play: () => void;
  pause: () => void;
  /** seek to an exact position in the whole edited timeline (seconds) */
  seekToTime: (sec: number) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const NativeView: React.ComponentType<any> = requireNativeView('VideoPreview');

const VideoPreviewView = forwardRef<VideoPreviewHandle, VideoPreviewProps>(function VideoPreviewView(
  { timeline, loop = true, paused = false, style, onProgress, onActiveIndexChange, onPlayingChange, onReady },
  ref,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nativeRef = useRef<any>(null);

  useImperativeHandle(
    ref,
    () => ({
      play: () => nativeRef.current?.play(),
      pause: () => nativeRef.current?.pause(),
      seekToTime: (sec: number) => nativeRef.current?.seekToTime(sec),
    }),
    [],
  );

  return (
    <NativeView
      ref={nativeRef}
      style={style}
      timeline={timeline}
      loop={loop}
      paused={paused}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onProgress={(e: any) => onProgress?.(e.nativeEvent)}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onActiveIndexChange={(e: any) => onActiveIndexChange?.(e.nativeEvent.index)}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onPlayingChange={(e: any) => onPlayingChange?.(e.nativeEvent.isPlaying)}
      onReady={() => onReady?.()}
    />
  );
});

export default VideoPreviewView;
