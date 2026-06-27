import { AnalysisClip, Edl, TimelineItem } from './types';
import { VibeConfig, DAILY_REEL } from './vibes';
import { bestSegment, ClipCandidate } from './scoring';

/** Order keepers chronologically. We have no cross-clip capture time in v1, so clipId
 *  (clip_01, clip_02, … assigned in picker order) is the chronological proxy. */
function byClipIdChronological(a: ClipCandidate, b: ClipCandidate): number {
  return a.clipId.localeCompare(b.clipId, undefined, { numeric: true, sensitivity: 'base' });
}

function segDuration(c: ClipCandidate): number {
  return Math.max(0, c.out - c.in);
}

/**
 * The selection brain: analyses → EDL.
 *  1. best segment per clip
 *  2. keep above threshold (fallback to the single best if none clear it)
 *  3. natural length = sum of kept segments
 *  4. clamp to the vibe's [min,max]: over max → drop weakest-of-good; under min → keep as-is (tight > padded)
 *  5. order chronologically
 */
export function selectTimeline(analyses: AnalysisClip[], vibe: VibeConfig = DAILY_REEL): Edl {
  const candidates: ClipCandidate[] = analyses
    .map((c) => bestSegment(c, vibe))
    .filter((c): c is ClipCandidate => c !== null);

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
    // Smart default mutes most; Phase 4 (audio keep/mute, energy v1) sets this from meanAudioRMS.
    muted: true,
  }));

  return {
    vibe: vibe.id,
    targetDuration: Math.round(naturalLen * 10) / 10,
    audioMode: vibe.audioMode,
    timeline,
  };
}
