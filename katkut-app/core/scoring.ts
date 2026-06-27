import { AnalysisClip, AnalysisWindow } from './types';
import { VibeConfig } from './vibes';

/** Ideal exposure (well-lit). Score peaks here and falls off toward dark/blown. */
const IDEAL_EXPOSURE = 0.5;

/** dBFS range used to normalise audioRMS into 0..1. */
const RMS_SILENCE_DBFS = -60;
const RMS_LOUD_DBFS = -10;

export function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/** 1.0 at IDEAL_EXPOSURE, falling to 0 toward fully dark / fully blown. */
export function exposureScore(exposure: number): number {
  const dist = Math.abs(exposure - IDEAL_EXPOSURE) / IDEAL_EXPOSURE;
  return clamp01(1 - dist * dist);
}

/** Map audioRMS (dBFS) to 0..1. Used mildly for daily reel (see audio caveat, technical doc §3.2). */
export function audioScore(audioRMS: number): number {
  return clamp01((audioRMS - RMS_SILENCE_DBFS) / (RMS_LOUD_DBFS - RMS_SILENCE_DBFS));
}

/** Score a single window. Higher = better keeper. */
export function windowScore(w: AnalysisWindow, vibe: VibeConfig): number {
  const { weights } = vibe;
  return (
    weights.sharp * (1 - clamp01(w.blur)) +
    weights.exposure * exposureScore(w.exposure) +
    weights.audio * audioScore(w.audioRMS) -
    weights.frozenPenalty * (w.frozen ? 1 : 0)
  );
}

export interface ClipCandidate {
  clipId: string;
  /** chosen in-point, seconds */
  in: number;
  /** chosen out-point, seconds */
  out: number;
  /** duration-weighted mean window score over the chosen segment */
  score: number;
  /** mean audioRMS over the chosen segment (for later audio keep/mute) */
  meanAudioRMS: number;
}

function windowDuration(w: AnalysisWindow): number {
  return Math.max(0, w.end - w.start);
}

/**
 * Pick the best contiguous run of windows within a clip whose total length is in
 * [minSegment, maxSegment], maximising the duration-weighted mean window score.
 * If the clip is shorter than minSegment, the whole clip is the segment.
 */
export function bestSegment(clip: AnalysisClip, vibe: VibeConfig): ClipCandidate | null {
  const windows = clip.windows;
  if (windows.length === 0) return null;

  const scores = windows.map((w) => windowScore(w, vibe));
  const durs = windows.map(windowDuration);

  const totalDur = durs.reduce((a, b) => a + b, 0);

  // Clip too short to trim — take the whole thing.
  if (totalDur <= vibe.minSegment) {
    const sumScoreDur = scores.reduce((a, s, i) => a + s * durs[i], 0);
    const sumAudioDur = windows.reduce((a, w, i) => a + w.audioRMS * durs[i], 0);
    return {
      clipId: clip.clipId,
      in: windows[0].start,
      out: windows[windows.length - 1].end,
      score: totalDur > 0 ? sumScoreDur / totalDur : 0,
      meanAudioRMS: totalDur > 0 ? sumAudioDur / totalDur : windows[0].audioRMS,
    };
  }

  let best: ClipCandidate | null = null;

  for (let i = 0; i < windows.length; i++) {
    let segDur = 0;
    let sumScoreDur = 0;
    let sumAudioDur = 0;
    for (let j = i; j < windows.length; j++) {
      segDur += durs[j];
      sumScoreDur += scores[j] * durs[j];
      sumAudioDur += windows[j].audioRMS * durs[j];
      if (segDur < vibe.minSegment) continue;
      if (segDur > vibe.maxSegment) break;
      const mean = sumScoreDur / segDur;
      if (best === null || mean > best.score) {
        best = {
          clipId: clip.clipId,
          in: windows[i].start,
          out: windows[j].end,
          score: mean,
          meanAudioRMS: sumAudioDur / segDur,
        };
      }
    }
  }

  return best;
}
