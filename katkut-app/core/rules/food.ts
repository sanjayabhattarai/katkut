import { AnalysisClip, AnalysisWindow } from '../types';
import { FOOD_COOKING, VibeConfig } from '../vibes';
import { ClipCandidate, windowScore } from '../scoring';
import { VibeRule, VibeRunParams } from './types';

/**
 * FOOD & COOKING — Aesthetic & Fast-Paced.
 * Goal: appetising, punchy cuts that feel like a food-content creator made them.
 *
 * Key difference from Auto: segments are SHORT (0.5–1.5s). Each segment snaps its out-point
 * to the nearest scene cut so the edit lands exactly on the action moment (fork hitting a plate,
 * a sizzle, a pour, a bite). This sub-second precision comes from the native analyser's scene-cut
 * timestamps (~0.1s resolution), not from the 1s analysis windows.
 *
 * Audio: food sounds ARE the content (sizzling, crunching, chopping) — keep more of them.
 */

// --- tunables ---
const REJECT_BLUR = 0.65;   // stricter than Auto (0.72): food needs crisp, sharp footage
const REJECT_DARK = 0.10;   // underlit kitchen shots are unusable
const REJECT_BRIGHT = 0.96; // overexposed shots (kitchen lights) are unusable

function usableWindow(w: AnalysisWindow): boolean {
  return (
    !w.frozen &&
    w.blur < REJECT_BLUR &&
    w.exposure > REJECT_DARK &&
    w.exposure < REJECT_BRIGHT
  );
}

/** Score + mean audio over [inSec, outSec], weighted by window overlap. */
function statsOver(
  clip: AnalysisClip,
  cfg: VibeConfig,
  inSec: number,
  outSec: number,
): { score: number; meanAudioRMS: number } | null {
  let sumScoreDur = 0;
  let sumAudioDur = 0;
  let dur = 0;
  for (const w of clip.windows) {
    const lo = Math.max(w.start, inSec);
    const hi = Math.min(w.end, outSec);
    const d = hi - lo;
    if (d > 0) {
      sumScoreDur += windowScore(w, cfg) * d;
      sumAudioDur += w.audioRMS * d;
      dur += d;
    }
  }
  if (dur <= 0) return null;
  return { score: sumScoreDur / dur, meanAudioRMS: sumAudioDur / dur };
}

export const foodRule: VibeRule = {
  id: 'food_cooking',

  resolveConfig(params: VibeRunParams): VibeConfig {
    return {
      ...FOOD_COOKING,
      minDuration: params.lengthMin,
      maxDuration: params.lengthMax,
      // 1.0–1.5s per segment = the fast-cut food-reel feel without jitter (0.5s reads as a flicker).
      // bestSegment produces 1s units (one window); refineSegment then snaps the out-point to
      // a nearby scene cut, so a segment lands between 1.0s and 1.5s.
      minSegment: 1.0,
      maxSegment: 1.5,
      // Crispness is king; exposure equally important (well-lit food); don't over-penalise
      // a steady held close-up shot (frozenPenalty reduced vs Auto); keep food sounds.
      weights: { sharp: 1.3, exposure: 1.0, frozenPenalty: 0.7, audio: 0.4 },
      // Food audio IS the content (sizzling, crunching, chopping) — keep it more aggressively
      keepAudioThreshold: -32,
    };
  },

  // Reject clips with no usable moment — stricter blur threshold than Auto.
  rejectClip(clip: AnalysisClip): boolean {
    if (clip.windows.length === 0) return true;
    return !clip.windows.some(usableWindow);
  },

  // Snap the out-point to the FIRST scene cut within [minOut, maxOut].
  // Why first (not closest)? Food edits cut ON the action moment (the bite, the pour, the sizzle),
  // not at some average "natural end". The first available scene cut inside the window is that
  // action boundary.
  // Fallback when no scene cut in range: use the shortest viable cut (cfg.minSegment end) —
  // for food, shorter is snappier, so we prefer tight over loose.
  refineSegment(clip: AnalysisClip, cand: ClipCandidate, cfg: VibeConfig): ClipCandidate {
    const minOut = cand.in + cfg.minSegment;
    const maxOut = Math.min(cand.in + cfg.maxSegment, clip.duration || cand.out);
    if (maxOut <= minOut) return cand;

    // First scene cut inside the valid range.
    const cut = clip.sceneCuts.find((t) => t >= minOut && t <= maxOut);
    const out = cut ?? minOut; // no cut → shortest possible cut (tightest)

    if (Math.abs(out - cand.out) < 1e-6) return cand;

    const stats = statsOver(clip, cfg, cand.in, out);
    return stats
      ? { ...cand, out, score: stats.score, meanAudioRMS: stats.meanAudioRMS }
      : { ...cand, out };
  },
};
