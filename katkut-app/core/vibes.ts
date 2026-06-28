/** Tunable knobs for one vibe/preset. Per-vibe MIN/MAX is just two numbers (see technical doc §3.4). */
export interface VibeConfig {
  id: string;
  /** display name — named after the feel delivered (e.g. "Snappy"), never a literal effect. */
  label: string;
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
  /**
   * Smart audio: keep a clip's original audio (muted=false) when its segment is "loud sustained"
   * — mean loudness at/above this dBFS. Below it the clip is muted. Tunable; expect false positives
   * (wind/handling noise), which the user overrides in the editor (Phase 3).
   */
  keepAudioThreshold: number;
}

/** Default preset (v1 ships ONE vertical/preset; build order: "one preset, no polish"). */
export const DAILY_REEL: VibeConfig = {
  id: 'daily_reel',
  label: 'Balanced',
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
  keepAudioThreshold: -25,
};

/**
 * "Re-cut vibe" pacing variants (UI doc §4.5): regenerate the EDL from the SAME cached
 * analyses — no re-analyze. Same scoring signals, just different pacing/strictness knobs.
 */
export const SNAPPY: VibeConfig = {
  ...DAILY_REEL,
  id: 'snappy',
  label: 'Snappy',
  minDuration: 45,
  maxDuration: 90,
  minSegment: 1.5,
  maxSegment: 2.5,
  keepThreshold: 0.55, // stricter → fewer, punchier clips
};

export const RELAXED: VibeConfig = {
  ...DAILY_REEL,
  id: 'relaxed',
  label: 'Relaxed',
  minDuration: 60,
  maxDuration: 120,
  minSegment: 3.0,
  maxSegment: 5.0,
  keepThreshold: 0.35, // looser → more clips, slower pace
};

/**
 * Vibe/style presets surfaced in the picker sheet ("what type of video is this?").
 * NOTE: these re-weight the EXISTING analysis signals (sharpness / exposure / freeze / audio)
 * and pacing — we do NOT yet measure motion vectors, so "Travel favors action" is approximated
 * via looser/snappier knobs rather than true motion analysis (a later enhancement).
 */
export const AUTO: VibeConfig = {
  ...DAILY_REEL,
  id: 'auto',
  label: 'Auto',
};

export const FOOD: VibeConfig = {
  ...DAILY_REEL,
  id: 'food_vlog',
  label: 'Food',
  minDuration: 20,
  maxDuration: 45,
  minSegment: 2.0,
  maxSegment: 4.0,
  // appetizing close-ups: reward sharpness + good exposure
  weights: { sharp: 1.2, exposure: 0.9, frozenPenalty: 1.3, audio: 0.2 },
  keepThreshold: 0.45,
};

export const TRAVEL: VibeConfig = {
  ...DAILY_REEL,
  id: 'travel_vlog',
  label: 'Travel',
  minDuration: 45,
  maxDuration: 100,
  minSegment: 1.5,
  maxSegment: 3.0,
  // scenic + lively: looser keep, snappier cuts (proxy for "action" until we add motion vectors)
  weights: { sharp: 1.0, exposure: 0.7, frozenPenalty: 1.8, audio: 0.3 },
  keepThreshold: 0.4,
};

export const COOKING: VibeConfig = {
  ...DAILY_REEL,
  id: 'cooking',
  label: 'Cooking',
  minDuration: 30,
  maxDuration: 90,
  minSegment: 2.5,
  maxSegment: 5.0,
  // steady process shots held longer; don't over-penalize near-static (steady ≠ frozen)
  weights: { sharp: 1.1, exposure: 0.6, frozenPenalty: 0.9, audio: 0.2 },
  keepThreshold: 0.4,
};

export const VIBES: Record<string, VibeConfig> = {
  [DAILY_REEL.id]: DAILY_REEL,
  [SNAPPY.id]: SNAPPY,
  [RELAXED.id]: RELAXED,
  [AUTO.id]: AUTO,
  [FOOD.id]: FOOD,
  [TRAVEL.id]: TRAVEL,
  [COOKING.id]: COOKING,
};

/** The vibe options shown in the selector sheet, in display order. */
export const VIBE_CHOICES: VibeConfig[] = [AUTO, FOOD, TRAVEL, COOKING];
