// App-level (UI) types. The pure-TS pipeline brain lives in core/.

/** A clip the user picked from their gallery. Local only — never uploaded. */
export interface PickedClip {
  /** clip_01, clip_02, … assigned in pick order (also the chronological proxy core/ uses). */
  clipId: string;
  /** local URI (file:// or content://) the native side can open. */
  uri: string;
  fileName: string | null;
  /** duration in ms as reported by the picker, if available. */
  durationMs: number | null;
  width: number | null;
  height: number | null;
}
