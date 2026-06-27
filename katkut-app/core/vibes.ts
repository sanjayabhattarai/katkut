import { AudioMode } from './types';

/** Tunable knobs for one vibe/preset. Per-vibe MIN/MAX is just two numbers (see technical doc §3.4). */
export interface VibeConfig {
  id: string;
  /** clamp range for total reel length, seconds */
  minDuration: number;
  maxDuration: number;
  /** per-clip chosen segment length range, seconds */
  minSegment: number;
  maxSegment: number;
  /** scoring weights */
  weights: {
    sharp: number;
    exposure: number;
    /** subtracted when a window is frozen */
    frozenPenalty: number;
    audio: number;
  };
  /** minimum clipScore for a clip to be a keeper */
  keepThreshold: number;
  /** default audio behaviour for this vibe */
  audioMode: AudioMode;
  /**
   * Smart audio: keep a clip's original audio (muted=false) when its segment is "loud sustained"
   * — mean loudness at/above this dBFS. Below it the clip is muted. Tunable; expect false positives
   * (wind/handling noise), which the user overrides in the editor (Phase 3).
   */
  keepAudioThreshold: number;
}

/** v1 ships ONE preset (build order: "one preset, no polish"). */
export const DAILY_REEL: VibeConfig = {
  id: 'daily_reel',
  minDuration: 60,
  maxDuration: 120,
  minSegment: 2.0,
  maxSegment: 4.0,
  weights: {
    sharp: 1.0,
    exposure: 0.6,
    frozenPenalty: 1.5,
    audio: 0.2,
  },
  keepThreshold: 0.45,
  audioMode: 'smart',
  keepAudioThreshold: -25,
};

export const VIBES: Record<string, VibeConfig> = {
  [DAILY_REEL.id]: DAILY_REEL,
};
