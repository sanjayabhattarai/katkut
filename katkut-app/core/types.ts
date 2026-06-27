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

export type AudioMode = 'smart' | 'on' | 'off';

/** One segment on the output timeline (the editor mutates these). */
export interface TimelineItem {
  clipId: string;
  /** in-point in source clip, seconds */
  in: number;
  /** out-point in source clip, seconds */
  out: number;
  /** whether this clip's original audio is muted in the export */
  muted: boolean;
}

/** Decision list / EDL (output of selection; same shape the editor mutates). */
export interface Edl {
  vibe: string;
  /** total reel duration in seconds (sum of timeline segment lengths) */
  targetDuration: number;
  audioMode: AudioMode;
  timeline: TimelineItem[];
}
