// JS-side wrappers around native Android Media API modules (under /modules).
// No FFmpeg — see CLAUDE.md rule 9.
export { default as MediaProbe } from '../modules/media-probe';
export type { MediaProbeResult } from '../modules/media-probe';

export { default as VideoAnalysis } from '../modules/video-analysis';

export { default as VideoAssembler } from '../modules/video-assembler';
export type {
  AssembleSegment,
  ExportResolution,
  PhotoMotionType,
} from '../modules/video-assembler/src/VideoAssemblerModule';
