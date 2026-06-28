import { describe, it, expect } from 'vitest';
import { Edl } from './types';
import {
  moveClip,
  reorderClip,
  toggleMute,
  deleteClip,
  trimOut,
  trimIn,
  recomputeTargetDuration,
} from './edl';

function makeEdl(): Edl {
  return {
    vibe: 'daily_reel',
    targetDuration: 9,
    timeline: [
      { clipId: 'clip_01', in: 0, out: 3, muted: true },
      { clipId: 'clip_02', in: 1, out: 4, muted: false },
      { clipId: 'clip_03', in: 0, out: 2, muted: true },
    ],
  };
}

describe('moveClip', () => {
  it('swaps with the next clip', () => {
    const edl = moveClip(makeEdl(), 0, 1);
    expect(edl.timeline.map((t) => t.clipId)).toEqual(['clip_02', 'clip_01', 'clip_03']);
  });
  it('swaps with the previous clip', () => {
    const edl = moveClip(makeEdl(), 1, -1);
    expect(edl.timeline.map((t) => t.clipId)).toEqual(['clip_02', 'clip_01', 'clip_03']);
  });
  it('is a no-op at the boundaries', () => {
    const edl = makeEdl();
    expect(moveClip(edl, 0, -1)).toBe(edl);
    expect(moveClip(edl, edl.timeline.length - 1, 1)).toBe(edl);
  });
});

describe('reorderClip', () => {
  it('moves a clip from front to back', () => {
    const edl = reorderClip(makeEdl(), 0, 2);
    expect(edl.timeline.map((t) => t.clipId)).toEqual(['clip_02', 'clip_03', 'clip_01']);
  });
  it('moves a clip from back to front', () => {
    const edl = reorderClip(makeEdl(), 2, 0);
    expect(edl.timeline.map((t) => t.clipId)).toEqual(['clip_03', 'clip_01', 'clip_02']);
  });
  it('is a no-op when from === to or out of range', () => {
    const edl = makeEdl();
    expect(reorderClip(edl, 1, 1)).toBe(edl);
    expect(reorderClip(edl, -1, 0)).toBe(edl);
    expect(reorderClip(edl, 0, 5)).toBe(edl);
  });
});

describe('toggleMute', () => {
  it('flips only the targeted clip', () => {
    const edl = toggleMute(makeEdl(), 0);
    expect(edl.timeline[0].muted).toBe(false);
    expect(edl.timeline[1].muted).toBe(false);
    expect(edl.timeline[2].muted).toBe(true);
  });
});

describe('deleteClip', () => {
  it('removes the targeted clip and recomputes duration', () => {
    const edl = deleteClip(makeEdl(), 1);
    expect(edl.timeline.map((t) => t.clipId)).toEqual(['clip_01', 'clip_03']);
    expect(edl.targetDuration).toBe(5); // (3-0) + (2-0)
  });
  it('refuses to delete the last remaining clip', () => {
    const single: Edl = {
      vibe: 'daily_reel',
      targetDuration: 3,
      timeline: [{ clipId: 'clip_01', in: 0, out: 3, muted: true }],
    };
    expect(deleteClip(single, 0)).toBe(single);
  });
});

describe('trimOut', () => {
  it('extends the out point up to the source duration', () => {
    const edl = trimOut(makeEdl(), 0, 1, 10);
    expect(edl.timeline[0].out).toBe(4);
  });
  it('clamps to the source duration', () => {
    const edl = trimOut(makeEdl(), 0, 5, 3.5);
    expect(edl.timeline[0].out).toBe(3.5);
  });
  it('never lets out drop at/below in', () => {
    const edl = trimOut(makeEdl(), 0, -10, 10);
    expect(edl.timeline[0].out).toBeGreaterThan(edl.timeline[0].in);
  });
});

describe('trimIn', () => {
  it('moves the in point forward', () => {
    const edl = trimIn(makeEdl(), 1, 0.5);
    expect(edl.timeline[1].in).toBe(1.5);
  });
  it('never lets in drop below 0', () => {
    const edl = trimIn(makeEdl(), 0, -5);
    expect(edl.timeline[0].in).toBe(0);
  });
  it('never lets in reach/exceed out', () => {
    const edl = trimIn(makeEdl(), 0, 10);
    expect(edl.timeline[0].in).toBeLessThan(edl.timeline[0].out);
  });
});

describe('recomputeTargetDuration', () => {
  it('sums segment lengths', () => {
    const edl = recomputeTargetDuration(makeEdl());
    expect(edl.targetDuration).toBe(8); // 3 + 3 + 2
  });
});
