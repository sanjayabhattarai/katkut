import { AnalysisClip, Edl } from '../types';
import { VIBES, AUTO } from '../vibes';
import { bestSegment, ClipCandidate } from '../scoring';
import { assembleEdl } from '../selection';
import { VibeRule, VibeRunParams } from './types';
import { autoRule } from './auto';
import { foodRule } from './food';
import { travelRule } from './travel';
import { makeGenericRule } from './generic';

export type { VibeRule, VibeRunParams } from './types';

// Vibes with dedicated logic. Others fall back to the generic rule using their VibeConfig.
const RULES: Record<string, VibeRule> = {
  auto: autoRule,
  food_cooking: foodRule,
  travel_adventure: travelRule,
};

export function getVibeRule(vibeId: string): VibeRule {
  return RULES[vibeId] ?? makeGenericRule(VIBES[vibeId] ?? AUTO);
}

/**
 * Build the reel for a vibe + the user's length choice, applying that vibe's rules:
 * hard-reject junk clips → best segment per clip → refine its cut points → assemble the EDL.
 */
export function buildReel(analyses: AnalysisClip[], vibeId: string, params: VibeRunParams): Edl {
  const rule = getVibeRule(vibeId);
  const cfg = rule.resolveConfig(params);

  const candidates: ClipCandidate[] = analyses
    .filter((clip) => !rule.rejectClip(clip))
    .map((clip) => {
      const cand = bestSegment(clip, cfg);
      return cand ? rule.refineSegment(clip, cand, cfg) : null;
    })
    .filter((c): c is ClipCandidate => c !== null);

  return assembleEdl(candidates, cfg);
}
