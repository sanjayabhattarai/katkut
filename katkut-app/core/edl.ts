import { Edl } from './types';

/** Recompute targetDuration from the current timeline (informational field). */
export function recomputeTargetDuration(edl: Edl): Edl {
  const sum = edl.timeline.reduce((a, t) => a + Math.max(0, t.out - t.in), 0);
  return { ...edl, targetDuration: Math.round(sum * 10) / 10 };
}

/** Swap the clip at `index` with its neighbour at `index + direction` (reorder). */
export function moveClip(edl: Edl, index: number, direction: -1 | 1): Edl {
  const target = index + direction;
  if (index < 0 || index >= edl.timeline.length) return edl;
  if (target < 0 || target >= edl.timeline.length) return edl;
  const timeline = [...edl.timeline];
  [timeline[index], timeline[target]] = [timeline[target], timeline[index]];
  return { ...edl, timeline };
}

/** Move the clip at `from` to position `to` (drag-reorder to an arbitrary slot). */
export function reorderClip(edl: Edl, from: number, to: number): Edl {
  const len = edl.timeline.length;
  if (from === to) return edl;
  if (from < 0 || from >= len || to < 0 || to >= len) return edl;
  const timeline = [...edl.timeline];
  const [item] = timeline.splice(from, 1);
  timeline.splice(to, 0, item);
  return { ...edl, timeline };
}

export function toggleMute(edl: Edl, index: number): Edl {
  const timeline = edl.timeline.map((t, i) => (i === index ? { ...t, muted: !t.muted } : t));
  return { ...edl, timeline };
}

export function deleteClip(edl: Edl, index: number): Edl {
  if (edl.timeline.length <= 1) return edl; // never produce an empty reel from the editor
  const timeline = edl.timeline.filter((_, i) => i !== index);
  return recomputeTargetDuration({ ...edl, timeline });
}

/**
 * Nudge the out-point of the clip at `index` by deltaSec (±1-2s per the UI doc).
 * Clamped so in < out and out never exceeds the source clip's full duration.
 */
export function trimOut(edl: Edl, index: number, deltaSec: number, sourceDuration: number): Edl {
  const timeline = edl.timeline.map((t, i) => {
    if (i !== index) return t;
    const next = t.out + deltaSec;
    const clamped = Math.min(Math.max(next, t.in + 0.5), sourceDuration);
    return { ...t, out: clamped };
  });
  return recomputeTargetDuration({ ...edl, timeline });
}

/**
 * Nudge the in-point of the clip at `index` by deltaSec (±1-2s per the UI doc).
 * Clamped so in stays >= 0 and in < out.
 */
export function trimIn(edl: Edl, index: number, deltaSec: number): Edl {
  const timeline = edl.timeline.map((t, i) => {
    if (i !== index) return t;
    const next = t.in + deltaSec;
    const clamped = Math.min(Math.max(next, 0), t.out - 0.5);
    return { ...t, in: clamped };
  });
  return recomputeTargetDuration({ ...edl, timeline });
}
