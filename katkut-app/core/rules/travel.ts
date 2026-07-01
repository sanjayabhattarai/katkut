import { AnalysisClip, AnalysisWindow } from '../types';
import { TRAVEL_ADVENTURE, VibeConfig } from '../vibes';
import { ClipCandidate, windowScore } from '../scoring';
import { VibeRule, VibeRunParams } from './types';

/**
 * TRAVEL & ADVENTURE — Cinematic Landscapes.
 * Goal: dreamy, grand, sweeping views that don't feel rushed.
 *
 * Character (vs Auto/Food):
 *  - Holds are LONGER and never snappy — segments scale 1.5–4s with the total length, capped at 4s.
 *  - A steady tripod vista or a slow pan can read as `frozen` to the analyser; we do NOT treat that
 *    as junk here (frozen penalty is low, and rejectClip ignores frozen) — the still grandeur is
 *    the whole point. We only throw away genuinely blurry / dark / blown clips.
 *  - Cut placement follows the AUDIO ENVELOPE: an energetic passage (party, music, cheering) has a
 *    clear RMS drop, so we cut ON that drop → punchy. A quiet scenic clip has a flat envelope, so
 *    nothing says "cut" → it breathes out to the full cap.
 *
 * v1 audio caveat: this reads the per-window RMS ENVELOPE (~1s resolution), not a real beat/onset
 * tracker. It cuts on energy drops, which usually align with phrase / party-noise boundaries but
 * won't land on a musical downbeat. True beat-cutting waits for YAMNet/onset detection (LATER).
 */

// --- tunables (revisit during validation) ---
const REJECT_BLUR = 0.72;   // a window blurrier than this is unusable
const REJECT_DARK = 0.08;   // exposure below this is ~pitch black
const REJECT_BRIGHT = 0.97; // exposure above this is blown out
const AUDIO_DROP_DB = 6;    // an RMS fall of at least this many dB between windows = an audio "break"
const SNAP_TO_SCENE = 0.5;  // if a scene cut sits within this many seconds of the break, snap to it

/**
 * Segment pacing by chosen total length: short reels hold ~1.5–3s, long reels sweep up to the cap.
 * Ceiling is 4s everywhere — long enough to feel cinematic, short enough not to drag.
 * NOTE: analysis windows are 1s, so segments are ~1s-quantized before refineSegment nudges the
 * out-point (via scene cuts / audio breaks, 0.1s precision).
 */
function pacingForLength(maxLen: number): { minSegment: number; maxSegment: number } {
  if (maxLen <= 30) return { minSegment: 1.5, maxSegment: 3.0 };
  if (maxLen <= 60) return { minSegment: 2.0, maxSegment: 3.5 };
  if (maxLen <= 90) return { minSegment: 2.5, maxSegment: 4.0 };
  return { minSegment: 3.0, maxSegment: 4.0 }; // 90s+ — hold long, but never past 4s
}

// Usable for travel: sharp and well-lit. Frozen is intentionally allowed (steady vistas are keepers).
function usableWindow(w: AnalysisWindow): boolean {
  return w.blur < REJECT_BLUR && w.exposure > REJECT_DARK && w.exposure < REJECT_BRIGHT;
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

/**
 * Find the strongest audio "break" boundary within [minOut, maxOut]: the window boundary where the
 * RMS falls the most from one window to the next. Returns the boundary time (a window .end) if the
 * drop is at least AUDIO_DROP_DB, else null (flat/scenic envelope → no break).
 */
function audioBreak(clip: AnalysisClip, minOut: number, maxOut: number): number | null {
  let bestBoundary: number | null = null;
  let bestDrop = AUDIO_DROP_DB;
  for (let i = 0; i < clip.windows.length - 1; i++) {
    const boundary = clip.windows[i].end;
    if (boundary < minOut || boundary > maxOut) continue;
    const drop = clip.windows[i].audioRMS - clip.windows[i + 1].audioRMS; // energy falling off
    if (drop >= bestDrop) {
      bestDrop = drop;
      bestBoundary = boundary;
    }
  }
  return bestBoundary;
}

export const travelRule: VibeRule = {
  id: 'travel_adventure',

  resolveConfig(params: VibeRunParams): VibeConfig {
    const pace = pacingForLength(params.lengthMax);
    return {
      ...TRAVEL_ADVENTURE,
      minDuration: params.lengthMin,
      maxDuration: params.lengthMax,
      minSegment: pace.minSegment,
      maxSegment: pace.maxSegment,
      // Scenery is the content: reward sharpness + good light. Low frozen penalty so a locked-off
      // vista or slow pan isn't punished. Audio matters only for cut placement, not scoring weight.
      weights: { sharp: 1.1, exposure: 0.9, frozenPenalty: 0.4, audio: 0.2 },
    };
  },

  // Only throw away genuinely blurry / dark / blown clips. Frozen is fine — steady views are keepers.
  rejectClip(clip: AnalysisClip): boolean {
    if (clip.windows.length === 0) return true;
    return !clip.windows.some(usableWindow);
  },

  // Cut where the audio breaks (energy drop), snapping to a nearby scene cut for precision.
  // Flat/quiet envelope → no break → let the shot breathe to the full cap (maxOut).
  refineSegment(clip: AnalysisClip, cand: ClipCandidate, cfg: VibeConfig): ClipCandidate {
    const minOut = cand.in + cfg.minSegment;
    const maxOut = Math.min(cand.in + cfg.maxSegment, clip.duration || cand.out);
    if (maxOut <= minOut) return cand;

    const sceneOpts = clip.sceneCuts.filter((t) => t >= minOut && t <= maxOut);
    const brk = audioBreak(clip, minOut, maxOut);

    let out: number;
    if (brk !== null) {
      // Cut on the energy drop. If a scene cut sits right by it, snap to that (cleaner boundary).
      const near = sceneOpts.find((t) => Math.abs(t - brk) <= SNAP_TO_SCENE);
      out = near ?? brk;
    } else if (sceneOpts.length > 0) {
      // No audio break, but a scene change in range: cut on the latest one so the shot breathes.
      out = Math.max(...sceneOpts);
    } else {
      // Flat scenic envelope, no scene cut: let the grand view hold to the cap.
      out = maxOut;
    }

    out = Math.max(minOut, Math.min(out, maxOut));
    if (Math.abs(out - cand.out) < 1e-6) return cand;

    const stats = statsOver(clip, cfg, cand.in, out);
    return stats ? { ...cand, out, score: stats.score, meanAudioRMS: stats.meanAudioRMS } : { ...cand, out };
  },
};
