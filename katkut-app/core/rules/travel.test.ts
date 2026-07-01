import { describe, it, expect } from 'vitest';
import { AnalysisClip, AnalysisWindow } from '../types';
import { travelRule } from './travel';
import { buildReel } from './index';

function win(start: number, p: Partial<AnalysisWindow> = {}): AnalysisWindow {
  return {
    start,
    end: start + 1,
    blur: 0.1,
    audioRMS: -40, // quiet by default (scenic)
    exposure: 0.5,
    frozen: false,
    ...p,
  };
}

function clip(clipId: string, windows: AnalysisWindow[], extra: Partial<AnalysisClip> = {}): AnalysisClip {
  const duration = windows.length ? windows[windows.length - 1].end : 0;
  return { clipId, duration, orientation: 'landscape', sceneCuts: [], windows, uri: `file://${clipId}`, ...extra };
}

function scenicClip(id: string, len = 6): AnalysisClip {
  return clip(id, Array.from({ length: len }, (_, i) => win(i, { blur: 0.05, exposure: 0.5 })));
}

// ─── rejectClip ───────────────────────────────────────────────────────────────

describe('travelRule.rejectClip', () => {
  it('rejects a fully blurry clip', () => {
    const c = clip('c', [win(0, { blur: 0.8 }), win(1, { blur: 0.9 })]);
    expect(travelRule.rejectClip(c)).toBe(true);
  });

  it('rejects pitch-black and blown-out clips', () => {
    expect(travelRule.rejectClip(clip('a', [win(0, { exposure: 0.02 })]))).toBe(true);
    expect(travelRule.rejectClip(clip('b', [win(0, { exposure: 0.99 })]))).toBe(true);
  });

  it('KEEPS a steady frozen vista (frozen is not junk for travel)', () => {
    // A locked-off tripod landscape: sharp, well-lit, but frozen. Auto would reject; Travel keeps it.
    const c = clip('c', [win(0, { frozen: true, blur: 0.05 }), win(1, { frozen: true, blur: 0.05 })]);
    expect(travelRule.rejectClip(c)).toBe(false);
  });

  it('rejects an empty clip', () => {
    expect(travelRule.rejectClip(clip('c', []))).toBe(true);
  });
});

// ─── resolveConfig ────────────────────────────────────────────────────────────

describe('travelRule.resolveConfig', () => {
  it('holds longer as the total length grows, capping segments at 4s', () => {
    const short = travelRule.resolveConfig({ lengthMin: 0, lengthMax: 30 });
    expect([short.minSegment, short.maxSegment]).toEqual([1.5, 3.0]);

    const long = travelRule.resolveConfig({ lengthMin: 120, lengthMax: 300 });
    expect([long.minSegment, long.maxSegment]).toEqual([3.0, 4.0]);
  });

  it('never exceeds a 4s segment ceiling at any length', () => {
    for (const max of [30, 60, 90, 120, 300]) {
      const cfg = travelRule.resolveConfig({ lengthMin: 0, lengthMax: max });
      expect(cfg.maxSegment).toBeLessThanOrEqual(4.0);
    }
  });

  it('penalises freeze gently so steady vistas survive scoring', () => {
    const cfg = travelRule.resolveConfig({ lengthMin: 0, lengthMax: 60 });
    expect(cfg.weights.frozenPenalty).toBeLessThan(1.0);
  });

  it('passes the user length range through to the duration clamp', () => {
    const cfg = travelRule.resolveConfig({ lengthMin: 45, lengthMax: 100 });
    expect(cfg.minDuration).toBe(45);
    expect(cfg.maxDuration).toBe(100);
  });
});

// ─── refineSegment ────────────────────────────────────────────────────────────

describe('travelRule.refineSegment', () => {
  const cfg = travelRule.resolveConfig({ lengthMin: 0, lengthMax: 90 }); // minSegment=2.5, maxSegment=4.0

  it('cuts ON the audio break — where the energy drops off', () => {
    // Loud party audio for 3s, then it drops. Break is at the 3s boundary (within 2.5–4.0).
    const windows = [
      win(0, { audioRMS: -12 }),
      win(1, { audioRMS: -12 }),
      win(2, { audioRMS: -12 }),
      win(3, { audioRMS: -45 }), // energy falls off here
      win(4, { audioRMS: -45 }),
    ];
    const c = clip('c', windows, { duration: 5 });
    const cand = { clipId: 'c', in: 0, out: 4, score: 0.6, meanAudioRMS: -25 };
    const refined = travelRule.refineSegment(c, cand, cfg);
    expect(refined.out).toBe(3); // cut on the drop, not the full 4s
  });

  it('snaps the audio break to a nearby scene cut for a cleaner boundary', () => {
    const windows = [
      win(0, { audioRMS: -12 }),
      win(1, { audioRMS: -12 }),
      win(2, { audioRMS: -12 }),
      win(3, { audioRMS: -45 }), // break at boundary 3.0
      win(4, { audioRMS: -45 }),
    ];
    const c = clip('c', windows, { duration: 5, sceneCuts: [3.2] }); // scene cut 0.2s from the break
    const cand = { clipId: 'c', in: 0, out: 4, score: 0.6, meanAudioRMS: -25 };
    const refined = travelRule.refineSegment(c, cand, cfg);
    expect(refined.out).toBe(3.2); // snapped to the scene cut near the break
  });

  it('lets a quiet scenic shot breathe out to the full cap (no audio break)', () => {
    // Flat quiet envelope, no scene cuts → hold to maxOut (in + 4.0, clamped to duration).
    const c = scenicClip('c', 6); // all windows quiet & flat
    const cand = { clipId: 'c', in: 0, out: 3, score: 0.7, meanAudioRMS: -40 };
    const refined = travelRule.refineSegment(c, cand, cfg);
    expect(refined.out).toBe(4.0); // maxSegment cap
  });

  it('holds to the latest scene cut in range when the envelope is flat', () => {
    const c = clip('c', Array.from({ length: 6 }, (_, i) => win(i)), { duration: 6, sceneCuts: [2.8, 3.5] });
    const cand = { clipId: 'c', in: 0, out: 3, score: 0.7, meanAudioRMS: -40 };
    const refined = travelRule.refineSegment(c, cand, cfg);
    expect(refined.out).toBe(3.5); // latest scene cut within [2.5, 4.0]
  });

  it('leaves the candidate unchanged when the clip is too short to refine', () => {
    const c = clip('c', [win(0, { end: 1 })], { duration: 1 });
    const cand = { clipId: 'c', in: 0, out: 1, score: 0.7, meanAudioRMS: -40 };
    const refined = travelRule.refineSegment(c, cand, cfg);
    expect(refined.out).toBe(1);
  });
});

// ─── buildReel end-to-end ─────────────────────────────────────────────────────

describe('buildReel (travel_adventure end-to-end)', () => {
  it('drops blurry clips but keeps steady scenic ones', () => {
    const scenic = scenicClip('clip_01', 6);
    const blurry = clip('clip_02', [win(0, { blur: 0.9 }), win(1, { blur: 0.85 })]);
    const edl = buildReel([scenic, blurry], 'travel_adventure', { lengthMin: 0, lengthMax: 90 });
    expect(edl.timeline.every((t) => t.clipId !== 'clip_02')).toBe(true);
  });

  it('never produces a segment longer than the 4s cap', () => {
    const clips = Array.from({ length: 12 }, (_, i) => scenicClip(`clip_${i + 1}`, 8));
    const edl = buildReel(clips, 'travel_adventure', { lengthMin: 90, lengthMax: 120 });
    for (const t of edl.timeline) {
      expect(t.out - t.in).toBeLessThanOrEqual(4.0 + 0.01);
    }
  });

  it('respects the user-chosen length range', () => {
    const clips = Array.from({ length: 30 }, (_, i) => scenicClip(`clip_${i + 1}`, 6));
    const edl = buildReel(clips, 'travel_adventure', { lengthMin: 45, lengthMax: 60 });
    expect(edl.targetDuration).toBeLessThanOrEqual(60);
  });
});
