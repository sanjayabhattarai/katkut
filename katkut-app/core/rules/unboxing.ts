import { AnalysisClip, AnalysisWindow } from '../types';
import { UNBOXING_STYLE, VibeConfig } from '../vibes';
import { ClipCandidate, windowScore } from '../scoring';
import { VibeRule, VibeRunParams } from './types';

/**
 * UNBOXING & STYLE — The Reveal.
 * Goal: crisp product / detail shots that land on the reveal — the moment the item comes into focus
 * and is held to camera. Show the payoff, not the fumbling pull-out before it.
 *
 * Character (vs the other vibes):
 *  - Crispness is paramount. Strictest blur rejection of any vibe and the highest sharpness weight —
 *    a soft product shot is worthless for unboxing.
 *  - A HELD detail close-up is a keeper, so the freeze penalty is low (like Travel/Food).
 *  - The distinctive move: refineSegment adjusts the IN-point. It finds the "focus-lock" — the
 *    boundary where blur drops soft→sharp (the product snapping into focus) — and starts the cut
 *    there, so the blurry hands-in-the-box moment is never shown. Then it holds on the crisp detail,
 *    snapping the out-point to a scene cut (the person rotating / handling the item).
 *  - No focus-lock in the clip → fall back to Auto-style scene-cut snapping of the out-point.
 *
 * Uses only signals we measure today (blur, exposure, frozen, sceneCuts). Audio is minor here.
 */

// --- tunables (revisit during validation) ---
const REJECT_BLUR = 0.6;    // strictest of all vibes — the product must be crisp
const REJECT_DARK = 0.08;   // exposure below this is ~pitch black
const REJECT_BRIGHT = 0.97; // exposure above this is blown out
const BLUR_SHARP = 0.25;    // a window this sharp (or sharper) counts as "in focus / revealed"
const FOCUS_DROP = 0.2;     // blur must fall at least this much across a boundary to be a focus-lock

/**
 * Segment pacing by chosen total length: a mix of slower setups and snappier reveals, held detail
 * capped at 4s so it never drags. Ranges contain a whole second so bestSegment can find a segment.
 */
function pacingForLength(maxLen: number): { minSegment: number; maxSegment: number } {
  if (maxLen <= 30) return { minSegment: 1.5, maxSegment: 3.0 };
  if (maxLen <= 60) return { minSegment: 2.0, maxSegment: 3.5 };
  if (maxLen <= 90) return { minSegment: 2.0, maxSegment: 4.0 };
  return { minSegment: 2.5, maxSegment: 4.0 }; // 90s+
}

// Usable for unboxing: crisp and well-lit. Frozen is allowed (a held detail shot is a keeper).
function usableWindow(w: AnalysisWindow): boolean {
  return w.blur < REJECT_BLUR && w.exposure > REJECT_DARK && w.exposure < REJECT_BRIGHT;
}

/**
 * Find the focus-lock: the earliest boundary in [fromSec, latestSec] where blur drops soft→sharp
 * (the product snapping into focus). Earliest → we keep the most of the sharp reveal afterwards.
 * Returns the boundary time (a window .end) or null if there's no such transition.
 */
function focusLock(clip: AnalysisClip, fromSec: number, latestSec: number): number | null {
  for (let i = 0; i < clip.windows.length - 1; i++) {
    const boundary = clip.windows[i].end;
    if (boundary < fromSec || boundary > latestSec) continue;
    const drops = clip.windows[i].blur - clip.windows[i + 1].blur >= FOCUS_DROP;
    if (drops && clip.windows[i + 1].blur <= BLUR_SHARP) return boundary;
  }
  return null;
}

/** Duration-weighted score + mean audio over an arbitrary [inSec, outSec] sub-range. */
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

export const unboxingRule: VibeRule = {
  id: 'unboxing',

  resolveConfig(params: VibeRunParams): VibeConfig {
    const pace = pacingForLength(params.lengthMax);
    return {
      ...UNBOXING_STYLE,
      minDuration: params.lengthMin,
      maxDuration: params.lengthMax,
      minSegment: pace.minSegment,
      maxSegment: pace.maxSegment,
      // Detail is everything: highest sharpness weight, good light; held close-ups aren't punished
      // (low frozen penalty); audio is a minor cue (tape rip / crinkle), not a driver.
      weights: { sharp: 1.4, exposure: 0.8, frozenPenalty: 0.5, audio: 0.2 },
    };
  },

  // Strictest crispness gate. Frozen is allowed — a steady product close-up is a keeper.
  rejectClip(clip: AnalysisClip): boolean {
    if (clip.windows.length === 0) return true;
    return !clip.windows.some(usableWindow);
  },

  // Start on the reveal, hold the crisp detail.
  refineSegment(clip: AnalysisClip, cand: ClipCandidate, cfg: VibeConfig): ClipCandidate {
    const clipEnd = clip.duration || cand.out;

    // 1) Move the in-point to the focus-lock, if one exists with room for at least a min hold after.
    //    Room is measured against the clip end (the hold runs past the candidate's out-point).
    const lock = focusLock(clip, cand.in, clipEnd - cfg.minSegment);
    const inPoint = lock ?? cand.in;

    const minOut = inPoint + cfg.minSegment;
    const maxOut = Math.min(inPoint + cfg.maxSegment, clipEnd);
    if (maxOut <= minOut) return inPoint === cand.in ? cand : { ...cand, in: inPoint, out: maxOut };

    // 2) Hold on the reveal: prefer a scene cut in range (closest to a full hold), else hold to the cap.
    const sceneOpts = clip.sceneCuts.filter((t) => t >= minOut && t <= maxOut);
    const out =
      sceneOpts.length > 0
        ? sceneOpts.reduce((best, t) => (Math.abs(t - maxOut) < Math.abs(best - maxOut) ? t : best), sceneOpts[0])
        : maxOut;

    if (inPoint === cand.in && Math.abs(out - cand.out) < 1e-6) return cand;

    const stats = statsOver(clip, cfg, inPoint, out);
    return stats
      ? { ...cand, in: inPoint, out, score: stats.score, meanAudioRMS: stats.meanAudioRMS }
      : { ...cand, in: inPoint, out };
  },
};
