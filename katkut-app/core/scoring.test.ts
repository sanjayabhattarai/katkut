import { describe, it, expect } from 'vitest';
import { AnalysisClip, AnalysisWindow } from './types';
import {
  exposureScore,
  audioScore,
  windowScore,
  bestSegment,
  clamp01,
} from './scoring';
import { DAILY_REEL } from './vibes';

function win(partial: Partial<AnalysisWindow>, start: number, dur = 1): AnalysisWindow {
  return {
    start,
    end: start + dur,
    blur: 0.1,
    audioRMS: -20,
    exposure: 0.5,
    frozen: false,
    ...partial,
  };
}

const SHARP = (start: number) => win({ blur: 0.1, exposure: 0.5, frozen: false }, start);
const BLURRY = (start: number) => win({ blur: 0.85, exposure: 0.25, frozen: true }, start);

function clip(clipId: string, windows: AnalysisWindow[]): AnalysisClip {
  return {
    clipId,
    duration: windows.length,
    orientation: 'portrait',
    sceneCuts: [],
    windows,
  };
}

describe('clamp01', () => {
  it('clamps to [0,1]', () => {
    expect(clamp01(-2)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.3)).toBe(0.3);
  });
});

describe('exposureScore', () => {
  it('peaks at the ideal mid exposure', () => {
    expect(exposureScore(0.5)).toBe(1);
  });
  it('falls off toward dark and blown', () => {
    expect(exposureScore(0)).toBeLessThan(0.1);
    expect(exposureScore(1)).toBeLessThan(0.1);
    expect(exposureScore(0.3)).toBeGreaterThan(exposureScore(0.1));
  });
});

describe('audioScore', () => {
  it('is 0 at/below silence and 1 at/above loud', () => {
    expect(audioScore(-60)).toBe(0);
    expect(audioScore(-70)).toBe(0);
    expect(audioScore(-10)).toBe(1);
    expect(audioScore(0)).toBe(1);
  });
  it('is monotonic in between', () => {
    expect(audioScore(-40)).toBeLessThan(audioScore(-20));
  });
});

describe('windowScore', () => {
  it('rates a sharp, well-lit window far above a blurry frozen one', () => {
    expect(windowScore(SHARP(0), DAILY_REEL)).toBeGreaterThan(
      windowScore(BLURRY(0), DAILY_REEL),
    );
  });
  it('penalises frozen frames', () => {
    const moving = win({ frozen: false }, 0);
    const frozen = win({ frozen: true }, 0);
    expect(windowScore(moving, DAILY_REEL) - windowScore(frozen, DAILY_REEL)).toBeCloseTo(
      DAILY_REEL.weights.frozenPenalty,
      5,
    );
  });
});

describe('bestSegment', () => {
  it('returns null for a clip with no windows', () => {
    expect(bestSegment(clip('clip_01', []), DAILY_REEL)).toBeNull();
  });

  it('picks the sharp run over the blurry run', () => {
    const c = clip('clip_01', [
      SHARP(0),
      SHARP(1),
      SHARP(2),
      BLURRY(3),
      BLURRY(4),
      BLURRY(5),
    ]);
    const seg = bestSegment(c, DAILY_REEL)!;
    expect(seg).not.toBeNull();
    expect(seg.in).toBe(0);
    expect(seg.out - seg.in).toBeGreaterThanOrEqual(DAILY_REEL.minSegment);
    expect(seg.out - seg.in).toBeLessThanOrEqual(DAILY_REEL.maxSegment);
    expect(seg.out).toBeLessThanOrEqual(3);
    expect(seg.score).toBeGreaterThan(1.5);
  });

  it('uses the whole clip when shorter than minSegment', () => {
    const c = clip('clip_01', [win({}, 0, 1.5)]);
    const seg = bestSegment(c, DAILY_REEL)!;
    expect(seg.in).toBe(0);
    expect(seg.out).toBe(1.5);
  });
});
