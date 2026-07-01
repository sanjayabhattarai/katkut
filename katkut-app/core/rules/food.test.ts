import { describe, it, expect } from 'vitest';
import { AnalysisClip, AnalysisWindow } from '../types';
import { foodRule } from './food';
import { buildReel } from './index';

function win(start: number, p: Partial<AnalysisWindow> = {}): AnalysisWindow {
  return {
    start,
    end: start + 1,
    blur: 0.1,
    audioRMS: -30,
    exposure: 0.5,
    frozen: false,
    ...p,
  };
}

function clip(clipId: string, windows: AnalysisWindow[], extra: Partial<AnalysisClip> = {}): AnalysisClip {
  const duration = windows.length ? windows[windows.length - 1].end : 0;
  return { clipId, duration, orientation: 'portrait', sceneCuts: [], windows, uri: `file://${clipId}`, ...extra };
}

// A "good food clip": sharp, well-lit, no freeze.
function goodFoodClip(id: string): AnalysisClip {
  return clip(id, Array.from({ length: 4 }, (_, i) => win(i, { blur: 0.05, exposure: 0.55 })));
}

// ─── rejectClip ───────────────────────────────────────────────────────────────

describe('foodRule.rejectClip', () => {
  it('rejects a clip that is too blurry (food needs crisp macro shots)', () => {
    const c = clip('c', [win(0, { blur: 0.7 }), win(1, { blur: 0.8 })]);
    expect(foodRule.rejectClip(c)).toBe(true);
  });

  it('rejects a clip where the food threshold (0.65) is stricter than Auto (0.72)', () => {
    // blur=0.68 passes Auto's threshold but should fail Food's stricter check
    const c = clip('c', [win(0, { blur: 0.68 })]);
    expect(foodRule.rejectClip(c)).toBe(true);
  });

  it('rejects a frozen-only clip', () => {
    const c = clip('c', [win(0, { frozen: true }), win(1, { frozen: true })]);
    expect(foodRule.rejectClip(c)).toBe(true);
  });

  it('rejects an underlit kitchen clip', () => {
    const c = clip('c', [win(0, { exposure: 0.05 })]);
    expect(foodRule.rejectClip(c)).toBe(true);
  });

  it('rejects a blown-out clip (kitchen lights)', () => {
    const c = clip('c', [win(0, { exposure: 0.98 })]);
    expect(foodRule.rejectClip(c)).toBe(true);
  });

  it('keeps a clip that has at least one sharp, well-lit moment', () => {
    // one blurry window and one crisp window — should survive
    const c = clip('c', [win(0, { blur: 0.8 }), win(1, { blur: 0.1, exposure: 0.5 })]);
    expect(foodRule.rejectClip(c)).toBe(false);
  });

  it('rejects an empty clip', () => {
    expect(foodRule.rejectClip(clip('c', []))).toBe(true);
  });
});

// ─── resolveConfig ────────────────────────────────────────────────────────────

describe('foodRule.resolveConfig', () => {
  it('always produces 1.0–1.5s segment range regardless of chosen length', () => {
    for (const [min, max] of [[0, 30], [30, 60], [60, 90], [90, 120], [120, 300]] as const) {
      const cfg = foodRule.resolveConfig({ lengthMin: min, lengthMax: max });
      expect(cfg.minSegment).toBe(1.0);
      expect(cfg.maxSegment).toBe(1.5);
    }
  });

  it('passes the user length range through to the config duration clamp', () => {
    const cfg = foodRule.resolveConfig({ lengthMin: 30, lengthMax: 60 });
    expect(cfg.minDuration).toBe(30);
    expect(cfg.maxDuration).toBe(60);
  });

  it('has higher sharpness weight than exposure weight (crisp > bright for food)', () => {
    const cfg = foodRule.resolveConfig({ lengthMin: 0, lengthMax: 60 });
    expect(cfg.weights.sharp).toBeGreaterThan(cfg.weights.exposure);
  });

  it('keeps audio more aggressively than default (lower keepAudioThreshold)', () => {
    const cfg = foodRule.resolveConfig({ lengthMin: 0, lengthMax: 60 });
    // -32 is lower (more permissive) than DAILY_REEL's -25
    expect(cfg.keepAudioThreshold).toBeLessThan(-25);
  });
});

// ─── refineSegment ────────────────────────────────────────────────────────────

describe('foodRule.refineSegment', () => {
  const cfg = foodRule.resolveConfig({ lengthMin: 0, lengthMax: 60 }); // minSegment=1.0, maxSegment=1.5

  it('snaps to the first scene cut in range — not just the closest', () => {
    // Two scene cuts at 1.2s and 1.4s. Both are within the 1.0–1.5s window.
    // Food rule picks the FIRST (1.2s) — earliest action moment.
    const c = clip('c', [win(0), win(1), win(2), win(3)], { sceneCuts: [1.2, 1.4], duration: 4 });
    const cand = { clipId: 'c', in: 0.0, out: 1.0, score: 0.8, meanAudioRMS: -30 };
    const refined = foodRule.refineSegment(c, cand, cfg);
    expect(refined.out).toBe(1.2);
  });

  it('produces a segment at least minSegment (1.0s) long', () => {
    // scene cut at 1.3s — within [1.0, 1.5], so out = 1.3
    const c = clip('c', [win(0), win(1)], { sceneCuts: [1.3], duration: 2 });
    const cand = { clipId: 'c', in: 0.0, out: 1.0, score: 0.8, meanAudioRMS: -30 };
    const refined = foodRule.refineSegment(c, cand, cfg);
    expect(refined.out - refined.in).toBeGreaterThanOrEqual(cfg.minSegment);
  });

  it('ignores scene cuts outside the valid [minOut, maxOut] window', () => {
    // scene cut at 0.7s is BEFORE minOut (0.0 + 1.0 = 1.0) — must be ignored.
    // scene cut at 2.0s is AFTER maxOut (0.0 + 1.5 = 1.5) — must be ignored.
    // No valid cut → fallback to minOut = 1.0.
    const c = clip('c', [win(0), win(1), win(2)], { sceneCuts: [0.7, 2.0], duration: 3 });
    const cand = { clipId: 'c', in: 0.0, out: 1.0, score: 0.8, meanAudioRMS: -30 };
    const refined = foodRule.refineSegment(c, cand, cfg);
    expect(refined.out).toBeCloseTo(1.0); // fallback: minOut
  });

  it('falls back to minOut (1.0s) when no scene cut exists — shortest snappiest cut', () => {
    const c = clip('c', [win(0), win(1)], { sceneCuts: [], duration: 2 });
    const cand = { clipId: 'c', in: 0.0, out: 1.0, score: 0.8, meanAudioRMS: -30 };
    const refined = foodRule.refineSegment(c, cand, cfg);
    expect(refined.out).toBeCloseTo(1.0);
  });

  it('keeps the original candidate unchanged when clip is too short to refine', () => {
    // clip only 0.4s long → maxOut <= minOut → return unchanged
    const c = clip('c', [win(0, { end: 0.4 })], { duration: 0.4, sceneCuts: [] });
    const cand = { clipId: 'c', in: 0.0, out: 0.4, score: 0.8, meanAudioRMS: -30 };
    const refined = foodRule.refineSegment(c, cand, cfg);
    expect(refined.out).toBe(0.4);
  });
});

// ─── buildReel end-to-end ─────────────────────────────────────────────────────

describe('buildReel (food_cooking end-to-end)', () => {
  it('drops blurry clips and uses only sharp ones', () => {
    const good = goodFoodClip('clip_01');
    const blurry = clip('clip_02', [win(0, { blur: 0.9 }), win(1, { blur: 0.85 })]);
    const edl = buildReel([good, blurry], 'food_cooking', { lengthMin: 0, lengthMax: 60 });

    expect(edl.timeline.every((t) => t.clipId !== 'clip_02')).toBe(true);
  });

  it('produces segments no longer than 1.5s for food clips', () => {
    const clips = Array.from({ length: 10 }, (_, i) => goodFoodClip(`clip_${i + 1}`));
    const edl = buildReel(clips, 'food_cooking', { lengthMin: 0, lengthMax: 60 });

    for (const t of edl.timeline) {
      expect(t.out - t.in).toBeLessThanOrEqual(1.5 + 0.01); // +0.01 float tolerance
    }
  });

  it('snaps to sub-second scene-cut precision, producing tight 1.0–1.5s segments', () => {
    // Each clip has a scene cut at 1.3s — inside the 1.0–1.5s window.
    // The fallback (no-cut) would give 1.0s; with the scene cut it should be 1.3s.
    const clips = Array.from({ length: 6 }, (_, i) => {
      return clip(
        `clip_${i + 1}`,
        Array.from({ length: 4 }, (_, j) => win(j, { blur: 0.05, exposure: 0.5 })),
        { sceneCuts: [1.3], duration: 4 },
      );
    });
    const edl = buildReel(clips, 'food_cooking', { lengthMin: 0, lengthMax: 60 });

    const snapped = edl.timeline.filter((t) => Math.abs((t.out - t.in) - 1.3) < 0.05);
    // At least some clips should snap to the 1.3s scene cut
    expect(snapped.length).toBeGreaterThan(0);
  });

  it('respects the user-chosen length range', () => {
    const clips = Array.from({ length: 30 }, (_, i) => goodFoodClip(`clip_${i + 1}`));
    const edl = buildReel(clips, 'food_cooking', { lengthMin: 20, lengthMax: 40 });
    expect(edl.targetDuration).toBeLessThanOrEqual(40);
  });
});
