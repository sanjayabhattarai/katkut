import { File, Paths } from 'expo-file-system';
import { VideoAssembler } from '../native';
import type { PhotoMotionType } from '../modules/video-assembler/src/VideoAssemblerModule';
import { TimelineItem } from '../core';

// A photo timeline item → a small MP4 (the still + baked-in Ken Burns motion). Cached per
// clipId+size within the session so a photo used in both preview (720) and export isn't re-rendered
// for the same size twice.
const clipCache = new Map<string, string>();
let counter = 0;

/**
 * Render a photo timeline item into a video-only MP4 at width x height and return its path.
 * Both preview (720x1280) and export (1080x1920 / 720x1280) go through here, so the motion the user
 * sees in preview is exactly what's exported.
 */
export async function renderPhotoClip(
  item: TimelineItem,
  sourceUri: string,
  width: number,
  height: number,
): Promise<string> {
  const key = `${item.clipId}_${width}x${height}`;
  const hit = clipCache.get(key);
  if (hit) return hit;

  const out = new File(Paths.cache, `photo_${item.clipId}_${width}_${counter++}.mp4`);
  const durationSec = Math.max(0, item.out - item.in) || 1.0;
  const motionType = (item.motion?.type ?? '') as PhotoMotionType;
  const motionAmount = item.motion?.amount ?? 0;

  const { outputPath } = await VideoAssembler.renderPhoto(
    sourceUri,
    out.uri,
    width,
    height,
    durationSec,
    motionType,
    motionAmount,
  );
  clipCache.set(key, outputPath);
  return outputPath;
}
