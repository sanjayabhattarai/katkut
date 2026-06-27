import { describe, it, expect } from 'vitest';
import { AnalysisClip, AnalysisWindow } from './types';
import { selectTimeline } from './selection';
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

function goodClip(clipId: string, nWindows = 4): AnalysisClip {
  const windows = Array.from({ length: nWindows }, (_, i) =>
    win({ blur: 0.1, exposure: 0.5, frozen: false }, i),
  );
  return { clipId, duration: nWindows, orientation: 'portrait', sceneCuts: [], windows };
}

function badClip(clipId: string, nWindows = 4): AnalysisClip {
  const windows = Array.from({ length: nWindows }, (_, i) =>
    win({ blur: 0.9, exposure: 0.2, frozen: true, audioRMS: -55 }, i),
  );
  return { clipId, duration: nWindows, orientation: 'portrait', sceneCuts: [], windows };
}

describe('selectTimeline', () => {
  it('keeps good clips and drops clips below threshold', () => {
    const edl = selectTimeline([goodClip('clip_01'), badClip('clip_02')], DAILY_REEL);
    expect(edl.timeline.map((t) => t.clipId)).toEqual(['clip_01']);
  });

  it('never returns an empty reel when footage exists (fallback to best)', () => {
    const edl = selectTimeline([badClip('clip_01'), badClip('clip_02')], DAILY_REEL);
    expect(edl.timeline.length).toBe(1);
  });

  it('returns an empty timeline when there are no clips', () => {
    const edl = selectTimeline([], DAILY_REEL);
    expect(edl.timeline).toEqual([]);
    expect(edl.targetDuration).toBe(0);
  });

  it('orders kept clips chronologically by numeric clipId', () => {
    const edl = selectTimeline(
      [goodClip('clip_10'), goodClip('clip_2'), goodClip('clip_1')],
      DAILY_REEL,
    );
    expect(edl.timeline.map((t) => t.clipId)).toEqual(['clip_1', 'clip_2', 'clip_10']);
  });

  it('clamps total duration to the vibe maximum by dropping weakest-of-good', () => {
    const clips = Array.from({ length: 70 }, (_, i) =>
      goodClip(`clip_${String(i + 1).padStart(2, '0')}`),
    );
    const edl = selectTimeline(clips, DAILY_REEL);
    expect(edl.targetDuration).toBeLessThanOrEqual(DAILY_REEL.maxDuration);
    expect(edl.timeline.length).toBeLessThan(70);
  });

  it('allows short reels under min rather than padding', () => {
    const edl = selectTimeline([goodClip('clip_01')], DAILY_REEL);
    expect(edl.targetDuration).toBeLessThan(DAILY_REEL.minDuration);
    expect(edl.timeline.length).toBe(1);
  });

  it('defaults audioMode to smart and mutes clips by default', () => {
    const edl = selectTimeline([goodClip('clip_01')], DAILY_REEL);
    expect(edl.audioMode).toBe('smart');
    expect(edl.timeline.every((t) => t.muted)).toBe(true);
  });

  it('targetDuration equals the sum of kept segment lengths', () => {
    const edl = selectTimeline([goodClip('clip_01'), goodClip('clip_02')], DAILY_REEL);
    const sum = edl.timeline.reduce((a, t) => a + (t.out - t.in), 0);
    expect(edl.targetDuration).toBeCloseTo(Math.round(sum * 10) / 10, 5);
  });
});
