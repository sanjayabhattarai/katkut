import { NativeModule, requireNativeModule } from 'expo';

export interface AssembleSegment {
  uri: string;
  inSec: number;
  outSec: number;
  muted: boolean;
}

export type AssembleAudioMode = 'smart' | 'on' | 'off';

export type ExportResolution = '1080p' | '720p';

/** Ken Burns motion type for a photo clip; '' means no motion. */
export type PhotoMotionType = 'zoomIn' | 'zoomOut' | 'panLR' | 'panRL' | '';

declare class VideoAssemblerModule extends NativeModule<{}> {
  /** Trim+concat segments → one 1080x1920 MP4 at outputPath (local filesystem path). */
  assemble(
    segments: AssembleSegment[],
    outputPath: string,
    audioMode: AssembleAudioMode,
    resolution: ExportResolution,
  ): Promise<{ outputPath: string }>;

  /**
   * Render one still photo → a short video-only MP4 (width x height) with Ken Burns motion. The
   * result is a normal MP4 so preview + export consume it like a video clip.
   */
  renderPhoto(
    uri: string,
    outputPath: string,
    width: number,
    height: number,
    durationSec: number,
    motionType: PhotoMotionType,
    motionAmount: number,
  ): Promise<{ outputPath: string }>;

  /**
   * Low-res 720x1280 preview proxy of one clip (whole clip, audio passed through) → outputPath.
   * Preview-only; the original full-res file is untouched and used for export.
   */
  makeProxy(uri: string, outputPath: string): Promise<{ outputPath: string }>;
}

export default requireNativeModule<VideoAssemblerModule>('VideoAssembler');
