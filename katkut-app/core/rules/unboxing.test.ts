import { describe, it, expect } from 'vitest';
import { AnalysisClip, AnalysisWindow } from '../types';
import { unboxingRule } from './unboxing';
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

function crispClip(id: string, len = 5): AnalysisClip {
  return clip(id, Array.from({ length: len }, (_, i) => win(i, { blur: 0.05, exposure: 0.5 })));
}

// ─── rejectClip ───────────────────────────────────────────────────────────────

describe('unboxingRule.rejectClip', () => {
  it('applies the strictest blur gate (0.60) — softer than other vibes tolerate', () => {
    // blur 0.66 passes Auto (0.72) but must fail unboxing (0.60)
    expect(unboxingRule.rejectClip(clip('a', [win(0, { blur: 0.66 })]))).toBe(true);
  });

  it('rejects dark and blown-out clips', () => {
    expect(unboxingRule.rejectClip(clip('b', [win(0, { exposure: 0.02 })]))).toBe(true);
    expect(unboxingRule.rejectClip(clip('c', [win(0, { exposure: 0.99 })]))).toBe(true);
  });

  it('KEEPS a steady frozen product close-up (held detail is a keeper)', () => {
    const c = clip('d', [win(0, { frozen: true, blur: 0.05 }), win(1, { frozen: true, blur: 0.05 })]);
    expect(unboxingRule.rejectClip(c)).toBe(false);
  });

  it('rejects an empty clip', () => {
    expect(unboxingRule.rejectClip(clip('e', []))).toBe(true);
  });
});

// ─── resolveConfig ────────────────────────────────────────────────────────────

describe('unboxingRule.resolveConfig', () => {
  it('holds detail longer as total length grows, capping at 4s', () => {
    const short = unboxingRule.resolveConfig({ lengthMin: 0, lengthMax: 30 });
    expect([short.minSegment, short.maxSegment]).toEqual([1.5, 3.0]);
    const long = unboxingRule.resolveConfig({ lengthMin: 90, lengthMax: 120 });
    expect([long.minSegment, long.maxSegment]).toEqual([2.5, 4.0]);
  });

  it('never exceeds a 4s segment cap', () => {
    for (const max of [30, 60, 90, 120, 300]) {
      expect(unboxingRule.resolveConfig({ lengthMin: 0, lengthMax: max }).maxSegment).toBeLessThanOrEqual(4.0);
    }
  });

  it('weights sharpness highest of all signals (detail is the point)', () => {
    const cfg = unboxingRule.resolveConfig({ lengthMin: 0, lengthMax: 60 });
    expect(cfg.weights.sharp).toBeGreaterThan(cfg.weights.exposure);
    expect(cfg.weights.sharp).toBeGreaterThan(cfg.weights.frozenPenalty);
  });

  it('does not punish held detail (low frozen penalty)', () => {
    const cfg = unboxingRule.resolveConfig({ lengthMin: 0, lengthMax: 60 });
    expect(cfg.weights.frozenPenalty).toBeLessThan(1.0);
  });
});

// ─── refineSegment (the reveal) ────────────────────────────────────────────────

describe('unboxingRule.refineSegment', () => {
  const cfg = unboxingRule.resolveConfig({ lengthMin: 0, lengthMax: 90 }); // [2.0, 4.0]

  it('moves the in-point to the focus-lock (soft → sharp), skipping the blurry pull-out', () => {
    // 0–2s: soft (hands fumbling in the box). At 2s it snaps sharp (the reveal). Hold after.
    const windows = [
      win(0, { blur: 0.55 }),
      win(1, { blur: 0.5 }),
      win(2, { blur: 0.05 }), // revealed
      win(3, { blur: 0.05 }),
      win(4, { blur: 0.05 }),
      win(5, { blur: 0.05 }),
    ];
    const c = clip('c', windows, { duration: 6 });
    const cand = { clipId: 'c', in: 0, out: 3, score: 0.5, meanAudioRMS: -30 };
    const refined = unboxingRule.refineSegment(c, cand, cfg);
    expect(refined.in).toBe(2); // starts on the reveal, not at 0
  });

  it('holds the crisp detail — snaps the out-point to a scene cut in range', () => {
    const windows = [
      win(0, { blur: 0.55 }),
      win(1, { blur: 0.05 }), // reveal at boundary 1.0
      win(2, { blur: 0.05 }),
      win(3, { blur: 0.05 }),
      win(4, { blur: 0.05 }),
      win(5, { blur: 0.05 }),
    ];
    const c = clip('c', windows, { duration: 6, sceneCuts: [4.5] }); // scene cut within [1+2, 1+4]=[3,5]
    const cand = { clipId: 'c', in: 0, out: 3, score: 0.5, meanAudioRMS: -30 };
    const refined = unboxingRule.refineSegment(c, cand, cfg);
    expect(refined.in).toBe(1);
    expect(refined.out).toBe(4.5); // held to the scene cut
  });

  it('holds to the cap when there is no scene cut after the reveal', () => {
    const windows = [
      win(0, { blur: 0.55 }),
      win(1, { blur: 0.05 }), // reveal at 1.0
      win(2, { blur: 0.05 }),
      win(3, { blur: 0.05 }),
      win(4, { blur: 0.05 }),
      win(5, { blur: 0.05 }),
    ];
    const c = clip('c', windows, { duration: 6 }); // no scene cuts
    const cand = { clipId: 'c', in: 0, out: 3, score: 0.5, meanAudioRMS: -30 };
    const refined = unboxingRule.refineSegment(c, cand, cfg);
    expect(refined.in).toBe(1);
    expect(refined.out).toBe(5); // in(1) + maxSegment(4) = 5, within the 6s clip
  });

  it('falls back to Auto-style out-point snapping when there is no focus-lock', () => {
    // Uniformly crisp clip: no soft→sharp transition, so the in-point stays put.
    const c = clip('c', Array.from({ length: 6 }, (_, i) => win(i, { blur: 0.05 })), {
      duration: 6,
      sceneCuts: [3.5],
    });
    const cand = { clipId: 'c', in: 0, out: 3, score: 0.7, meanAudioRMS: -30 };
    const refined = unboxingRule.refineSegment(c, cand, cfg);
    expect(refined.in).toBe(0); // no reveal edge → in-point unchanged
    expect(refined.out).toBe(3.5); // snapped to the scene cut in [2, 4]
  });
});

// ─── buildReel end-to-end ─────────────────────────────────────────────────────

describe('buildReel (unboxing end-to-end)', () => {
  it('drops soft clips and keeps crisp ones', () => {
    const crisp = crispClip('clip_01', 5);
    const soft = clip('clip_02', [win(0, { blur: 0.65 }), win(1, { blur: 0.7 })]);
    const edl = buildReel([crisp, soft], 'unboxing', { lengthMin: 0, lengthMax: 90 });
    expect(edl.timeline.every((t) => t.clipId !== 'clip_02')).toBe(true);
  });

  it('starts kept segments on the reveal in clips that have one', () => {
    // Every clip: soft for 2s, then sharp reveal.
    const clips = Array.from({ length: 6 }, (_, i) =>
      clip(
        `clip_${i + 1}`,
        [
          win(0, { blur: 0.55 }),
          win(1, { blur: 0.5 }),
          win(2, { blur: 0.05 }),
          win(3, { blur: 0.05 }),
          win(4, { blur: 0.05 }),
          win(5, { blur: 0.05 }),
        ],
        { duration: 6 },
      ),
    );
    const edl = buildReel(clips, 'unboxing', { lengthMin: 0, lengthMax: 90 });
    expect(edl.timeline.length).toBeGreaterThan(0);
    for (const t of edl.timeline) expect(t.in).toBeGreaterThanOrEqual(2); // never before the reveal
  });

  it('keeps every segment within the 1.5–4s band', () => {
    const clips = Array.from({ length: 12 }, (_, i) => crispClip(`clip_${i + 1}`, 6));
    const edl = buildReel(clips, 'unboxing', { lengthMin: 0, lengthMax: 90 });
    for (const t of edl.timeline) {
      const len = t.out - t.in;
      expect(len).toBeGreaterThan(0);
      expect(len).toBeLessThanOrEqual(4.0 + 0.01);
    }
  });
});
