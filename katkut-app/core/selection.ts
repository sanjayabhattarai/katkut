import { AnalysisClip, Edl, PhotoMotion, PhotoRef, TimelineItem } from './types';
import { VibeConfig, DAILY_REEL } from './vibes';
import { bestSegment, ClipCandidate } from './scoring';

/**
 * Every photo occupies this fixed duration on the timeline, for every vibe. It's 1.0s (not 0.5s)
 * because photos carry Ken Burns motion (see photoMotionForIndex) — ~30 frames is enough for the
 * slow zoom/pan to actually read; 0.5s would make the motion imperceptible.
 */
export const PHOTO_DURATION = 1.0;

/** More than this many photos → montage mode (crossfades between the stills). */
export const PHOTO_MONTAGE_THRESHOLD = 4;
/** Crossfade length between photos in montage mode. */
export const PHOTO_CROSSFADE_MS = 120;

/**
 * Alternating Ken Burns motion so a run of photos never feels identical: push-in, pan across,
 * pull-back, pan the other way, repeat. Decided here in core/; native renders it.
 */
const PHOTO_MOTION_CYCLE: PhotoMotion[] = [
  { type: 'zoomIn', amount: 0.08 },
  { type: 'panLR', amount: 0.08 },
  { type: 'zoomOut', amount: 0.08 },
  { type: 'panRL', amount: 0.08 },
];

export function photoMotionForIndex(i: number): PhotoMotion {
  return PHOTO_MOTION_CYCLE[i % PHOTO_MOTION_CYCLE.length];
}

/** Order keepers chronologically. We have no cross-clip capture time in v1, so clipId
 *  (clip_01, clip_02, … assigned in picker order) is the chronological proxy. */
function byClipIdChronological(a: ClipCandidate, b: ClipCandidate): number {
  return a.clipId.localeCompare(b.clipId, undefined, { numeric: true, sensitivity: 'base' });
}

function segDuration(c: ClipCandidate): number {
  return Math.max(0, c.out - c.in);
}

/**
 * Shared assembly: a set of per-clip candidates → EDL. Used by `selectTimeline` and by the
 * per-vibe rules in `core/rules/`.
 *  1. keep above threshold (fallback to the single best if none clear it)
 *  2. natural length = sum of kept segments
 *  3. clamp to the vibe's [min,max]: over max → drop weakest-of-good; under min → keep as-is
 *  4. order chronologically; Smart audio sets `muted` per clip
 */
export function assembleEdl(candidates: ClipCandidate[], vibe: VibeConfig): Edl {
  let keepers = candidates.filter((c) => c.score > vibe.keepThreshold);

  // Never produce an empty reel if we have any footage at all.
  if (keepers.length === 0 && candidates.length > 0) {
    const best = candidates.reduce((a, b) => (b.score > a.score ? b : a));
    keepers = [best];
  }

  // Over max: drop weakest keepers until within budget.
  let naturalLen = keepers.reduce((a, c) => a + segDuration(c), 0);
  if (naturalLen > vibe.maxDuration) {
    const byScoreDesc = [...keepers].sort((a, b) => b.score - a.score);
    const kept: ClipCandidate[] = [];
    let acc = 0;
    for (const c of byScoreDesc) {
      const d = segDuration(c);
      if (acc + d > vibe.maxDuration) continue;
      kept.push(c);
      acc += d;
    }
    keepers = kept.length > 0 ? kept : [byScoreDesc[0]];
    naturalLen = keepers.reduce((a, c) => a + segDuration(c), 0);
  }
  // Under min: intentionally left as-is — shorter-but-tight beats longer-but-padded.

  const ordered = [...keepers].sort(byClipIdChronological);

  const timeline: TimelineItem[] = ordered.map((c) => ({
    clipId: c.clipId,
    in: c.in,
    out: c.out,
    // Smart default: keep audio on "loud sustained" clips, mute the rest (energy v1).
    muted: c.meanAudioRMS < vibe.keepAudioThreshold,
  }));

  return {
    vibe: vibe.id,
    targetDuration: Math.round(naturalLen * 10) / 10,
    timeline,
  };
}

/**
 * Append the user's photos to a video EDL as fixed-duration stills. Photos always land LAST and
 * always at PHOTO_DURATION, for every vibe — they are not scored, selected, or length-clamped
 * (the user can reposition them later in the editor). Each is muted (a still has no audio) and
 * carries alternating Ken Burns motion so the reel keeps momentum. When there are more than
 * PHOTO_MONTAGE_THRESHOLD photos, montage mode adds a short crossfade between the stills.
 * Photo order is preserved (pick order). targetDuration grows by the photos' total length.
 */
export function appendPhotos(edl: Edl, photos: PhotoRef[]): Edl {
  if (photos.length === 0) return edl;

  const montage = photos.length > PHOTO_MONTAGE_THRESHOLD;

  const photoItems: TimelineItem[] = photos.map((p, i) => ({
    clipId: p.clipId,
    in: 0,
    out: PHOTO_DURATION,
    muted: true,
    kind: 'photo',
    motion: photoMotionForIndex(i),
    ...(montage ? { crossfadeMs: PHOTO_CROSSFADE_MS } : {}),
  }));

  const added = PHOTO_DURATION * photos.length;
  return {
    ...edl,
    timeline: [...edl.timeline, ...photoItems],
    targetDuration: Math.round((edl.targetDuration + added) * 10) / 10,
  };
}

/**
 * The generic selection brain: analyses → EDL. Picks the best segment per clip, then assembles.
 * Per-vibe behavior (hard rejects, cut snapping, length-based pacing) lives in `core/rules/`.
 */
export function selectTimeline(analyses: AnalysisClip[], vibe: VibeConfig = DAILY_REEL): Edl {
  const candidates: ClipCandidate[] = analyses
    .map((c) => bestSegment(c, vibe))
    .filter((c): c is ClipCandidate => c !== null);

  return assembleEdl(candidates, vibe);
}
