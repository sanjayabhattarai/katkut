import { NativeModule, requireNativeModule } from 'expo';

export interface AssembleSegment {
  uri: string;
  inSec: number;
  outSec: number;
}

declare class VideoAssemblerModule extends NativeModule<{}> {
  /** Trim+concat segments → one 1080x1920 MP4 at outputPath (local filesystem path). */
  assemble(
    segments: AssembleSegment[],
    outputPath: string,
  ): Promise<{ outputPath: string }>;
}

export default requireNativeModule<VideoAssemblerModule>('VideoAssembler');
