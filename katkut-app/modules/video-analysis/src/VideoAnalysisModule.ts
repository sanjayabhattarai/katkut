import { NativeModule, requireNativeModule } from 'expo';
import type { AnalysisClip } from '../../../core';

declare class VideoAnalysisModule extends NativeModule<{}> {
  /** Single-pass native analysis of one clip → AnalysisClip JSON (audioRMS is a placeholder until 1C-2). */
  analyze(uri: string, clipId: string): Promise<AnalysisClip>;
}

export default requireNativeModule<VideoAnalysisModule>('VideoAnalysis');
