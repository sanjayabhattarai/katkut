import { describe, it, expect } from 'vitest';
import { AnalysisClip, AnalysisWindow, Edl, PhotoRef } from './types';
import { appendPhotos, PHOTO_DURATION, PHOTO_CROSSFADE_MS, PHOTO_MONTAGE_THRESHOLD } from './selection';
import { buildReel } from './rules';

function win(start: number, p: Partial<AnalysisWindow> = {}): AnalysisWindow {
  return { start, end: start + 1, blur: 0.05, audioRMS: -30, exposure: 0.5, frozen: false, ...p };
}

function videoClip(id: string, len = 4): AnalysisClip {
  return {
    clipId: id,
    duration: len,
    orientation: 'portrait',
    sceneCuts: [],
    windows: Array.from({ length: len }, (_, i) => win(i)),
    uri: `file://${id}`,
  };
}

const baseEdl: Edl = {
  vibe: 'auto',
  targetDuration: 6,
  timeline: [
    { clipId: 'clip_01', in: 0, out: 3, muted: false },
    { clipId: 'clip_02', in: 1, out: 4, muted: true },
  ],
};

describe('appendPhotos', () => {
  it('is a no-op when there are no photos', () => {
    expect(appendPhotos(baseEdl, [])).toBe(baseEdl);
  });

  it('appends photos LAST, after every video clip', () => {
    const photos: PhotoRef[] = [{ clipId: 'clip_03', uri: 'file://p3' }];
    const out = appendPhotos(baseEdl, photos);
    expect(out.timeline).toHaveLength(3);
    expect(out.timeline[2].clipId).toBe('clip_03'); // last
    expect(out.timeline.slice(0, 2)).toEqual(baseEdl.timeline); // videos untouched
  });

  it('makes every photo exactly PHOTO_DURATION and muted', () => {
    const photos: PhotoRef[] = [{ clipId: 'a' }, { clipId: 'b' }];
    const out = appendPhotos(baseEdl, photos);
    const stills = out.timeline.filter((t) => t.kind === 'photo');
    expect(stills).toHaveLength(2);
    for (const s of stills) {
      expect(s.in).toBe(0);
      expect(s.out).toBe(PHOTO_DURATION);
      expect(s.muted).toBe(true);
      expect(s.kind).toBe('photo');
    }
  });

  it('preserves photo order (pick order)', () => {
    const photos: PhotoRef[] = [{ clipId: 'p_a' }, { clipId: 'p_b' }, { clipId: 'p_c' }];
    const out = appendPhotos(baseEdl, photos);
    expect(out.timeline.slice(2).map((t) => t.clipId)).toEqual(['p_a', 'p_b', 'p_c']);
  });

  it('grows targetDuration by the photos total length', () => {
    const out = appendPhotos(baseEdl, [{ clipId: 'a' }, { clipId: 'b' }, { clipId: 'c' }]);
    expect(out.targetDuration).toBeCloseTo(6 + 3 * PHOTO_DURATION); // 6 + 1.5 = 7.5
  });

  it('does not mutate the input EDL', () => {
    const before = JSON.parse(JSON.stringify(baseEdl));
    appendPhotos(baseEdl, [{ clipId: 'a' }]);
    expect(baseEdl).toEqual(before);
  });

  it('gives every photo Ken Burns motion', () => {
    const out = appendPhotos(baseEdl, [{ clipId: 'a' }, { clipId: 'b' }]);
    for (const s of out.timeline.filter((t) => t.kind === 'photo')) {
      expect(s.motion).toBeDefined();
      expect(s.motion!.amount).toBeGreaterThan(0);
    }
  });

  it('alternates motion so consecutive photos differ (zoom, pan, zoom, pan…)', () => {
    const photos: PhotoRef[] = Array.from({ length: 4 }, (_, i) => ({ clipId: `p_${i}` }));
    const stills = appendPhotos(baseEdl, photos).timeline.filter((t) => t.kind === 'photo');
    const types = stills.map((t) => t.motion!.type);
    expect(types[0]).not.toBe(types[1]); // no two in a row identical
    expect(types[1]).not.toBe(types[2]);
    expect(types[2]).not.toBe(types[3]);
    expect(new Set(types).size).toBeGreaterThan(1); // genuine variety
  });

  it('does NOT crossfade with 4 or fewer photos (hard cuts, no montage)', () => {
    const photos: PhotoRef[] = Array.from({ length: PHOTO_MONTAGE_THRESHOLD }, (_, i) => ({ clipId: `p_${i}` }));
    const stills = appendPhotos(baseEdl, photos).timeline.filter((t) => t.kind === 'photo');
    expect(stills.every((t) => t.crossfadeMs === undefined)).toBe(true);
  });

  it('enters montage mode (crossfades) when there are more than the threshold', () => {
    const photos: PhotoRef[] = Array.from({ length: PHOTO_MONTAGE_THRESHOLD + 1 }, (_, i) => ({ clipId: `p_${i}` }));
    const stills = appendPhotos(baseEdl, photos).timeline.filter((t) => t.kind === 'photo');
    expect(stills.every((t) => t.crossfadeMs === PHOTO_CROSSFADE_MS)).toBe(true);
  });
});

describe('buildReel with photos', () => {
  it('places photos after the selected video clips regardless of vibe', () => {
    const videos = [videoClip('clip_01'), videoClip('clip_02')];
    const photos: PhotoRef[] = [{ clipId: 'clip_03', uri: 'file://p3' }];

    for (const vibe of ['auto', 'food_cooking', 'travel_adventure', 'mini_vlog', 'unboxing']) {
      const edl = buildReel(videos, vibe, { lengthMin: 0, lengthMax: 60 }, photos);
      const last = edl.timeline[edl.timeline.length - 1];
      expect(last.clipId).toBe('clip_03');
      expect(last.kind).toBe('photo');
      expect(last.out - last.in).toBeCloseTo(PHOTO_DURATION);
    }
  });

  it('keeps photos even when there is no usable video footage', () => {
    // no videos at all — the reel is photos only
    const photos: PhotoRef[] = [{ clipId: 'p1' }, { clipId: 'p2' }];
    const edl = buildReel([], 'auto', { lengthMin: 0, lengthMax: 60 }, photos);
    expect(edl.timeline).toHaveLength(2);
    expect(edl.timeline.every((t) => t.kind === 'photo')).toBe(true);
    expect(edl.targetDuration).toBeCloseTo(2 * PHOTO_DURATION);
  });

  it('photos are not subject to the length clamp (always included)', () => {
    // a tiny max that would clamp video hard — photos still survive on top
    const videos = Array.from({ length: 3 }, (_, i) => videoClip(`clip_0${i + 1}`));
    const photos: PhotoRef[] = Array.from({ length: 5 }, (_, i) => ({ clipId: `p_${i}` }));
    const edl = buildReel(videos, 'auto', { lengthMin: 0, lengthMax: 5 }, photos);
    const stills = edl.timeline.filter((t) => t.kind === 'photo');
    expect(stills).toHaveLength(5); // all five photos kept despite the 5s cap on video
  });
});
