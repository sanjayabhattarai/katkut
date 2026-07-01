// Canonical data shapes for the KatKut pipeline.
// These are the contracts: native/ analysis PRODUCES AnalysisClip[];
// core/ selection PRODUCES an Edl; native/ assemble CONSUMES the Edl.
// Pure TS — no React / native imports (HARD RULE 7).

export type Orientation = 'portrait' | 'landscape' | 'square';

/** One ~1s measurement window over a clip. All metrics are MEASURED by native/, never decided there. */
export interface AnalysisWindow {
  /** seconds from clip start */
  start: number;
  /** seconds from clip start */
  end: number;
  /** 0 = perfectly sharp, 1 = very blurry. High = discard. */
  blur: number;
  /** audio loudness in dBFS (negative; ~-60 silent, ~-10 loud). */
  audioRMS: number;
  /** 0 = black, ~0.5 = well-lit, 1 = blown out. */
  exposure: number;
  /** true if the frame is static/frozen/duplicate junk. */
  frozen: boolean;
}

/** Analysis JSON for one clip (output of native/ analysis). */
export interface AnalysisClip {
  clipId: string;
  /** source clip duration in seconds */
  duration: number;
  orientation: Orientation;
  /** scene-change timestamps in seconds (natural cut points) */
  sceneCuts: number[];
  windows: AnalysisWindow[];
  /** original local file URI — carried so assemble can find the source. */
  uri?: string;
}

/**
 * Ken Burns motion applied to a photo still so it doesn't freeze the reel's momentum. The type is
 * DECIDED in core/ (alternated across photos); native's OpenGL compositor executes it per frame.
 *  - zoomIn:  scale 1.0 → 1+amount   (slow push-in)
 *  - zoomOut: scale 1+amount → 1.0   (slow pull-back)
 *  - panLR / panRL: translate the framing left→right / right→left by `amount` of its width
 */
export interface PhotoMotion {
  type: 'zoomIn' | 'zoomOut' | 'panLR' | 'panRL';
  /** fractional amount, e.g. 0.08 = zoom/pan by 8%. */
  amount: number;
}

/** One segment on the output timeline (the editor mutates these). */
export interface TimelineItem {
  clipId: string;
  /** in-point in source clip, seconds. For a photo this is 0. */
  in: number;
  /** out-point in source clip, seconds. For a photo this is the fixed still duration. */
  out: number;
  /** whether this clip's original audio is muted in the export. Photos are always muted. */
  muted: boolean;
  /**
   * 'video' (default when absent) or 'photo'. A photo is a fixed-duration still: native renders it
   * as a freeze frame (with the blurred-fill for non-9:16) rather than decoding a video segment.
   */
  kind?: 'video' | 'photo';
  /** Ken Burns motion for a photo (undefined for videos). */
  motion?: PhotoMotion;
  /** crossfade duration (ms) INTO this item from the previous one. Set on photos in montage mode. */
  crossfadeMs?: number;
}

/** A still image the user picked. Photos skip analysis and become fixed-duration timeline stills. */
export interface PhotoRef {
  /** clip_NN assigned in pick order (shares the clipId space with videos). */
  clipId: string;
  /** local image URI the native side renders. */
  uri?: string;
}

/** Decision list / EDL (output of selection; same shape the editor mutates). */
export interface Edl {
  vibe: string;
  /** total reel duration in seconds (sum of timeline segment lengths) */
  targetDuration: number;
  timeline: TimelineItem[];
}
