import { File, Paths } from 'expo-file-system';
import { VideoAssembler } from '../native';
import { AnalysisClip, Edl } from '../core';
import { renderPhotoClip } from './photoClips';

// Preview proxies are throwaway low-res copies. Cache by source URI so a clip used twice
// (or after a re-cut) isn't transcoded again within the session.
const proxyBySource = new Map<string, string>();
let counter = 0;

/**
 * Generate (or reuse) a 720x1280 preview proxy for every clip in the EDL. Returns a
 * clipId → proxyUri map for the preview player. Originals are untouched (export uses them).
 * Failures fall back silently to the original for that clip.
 */
export async function generateProxies(
  analyses: AnalysisClip[],
  edl: Edl,
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, string>> {
  const sourceByClipId = new Map<string, string>();
  for (const a of analyses) if (a.uri) sourceByClipId.set(a.clipId, a.uri);

  // Photos (degenerate analyses with no windows) render to a small MP4 (still + motion) instead of
  // a video transcode, so the preview player can play them like any clip.
  const photoClipIds = new Set(analyses.filter((a) => a.windows.length === 0).map((a) => a.clipId));
  const itemByClipId = new Map(edl.timeline.map((t) => [t.clipId, t]));

  const clipIds = Array.from(new Set(edl.timeline.map((t) => t.clipId)));
  const result = new Map<string, string>();
  let done = 0;

  for (const clipId of clipIds) {
    const src = sourceByClipId.get(clipId);
    if (src) {
      if (photoClipIds.has(clipId)) {
        // preview-size photo clip (720x1280)
        try {
          const item = itemByClipId.get(clipId)!;
          result.set(clipId, await renderPhotoClip(item, src, 720, 1280));
        } catch {
          // leave it out — EdlPlayer skips photo items with no playable proxy
        }
      } else {
        let proxy = proxyBySource.get(src);
        if (!proxy) {
          try {
            const out = new File(Paths.cache, `proxy_${clipId}_${counter++}.mp4`);
            const { outputPath } = await VideoAssembler.makeProxy(src, out.uri);
            proxy = outputPath;
            proxyBySource.set(src, proxy);
          } catch {
            proxy = undefined; // fall back to original for this clip
          }
        }
        if (proxy) result.set(clipId, proxy);
      }
    }
    done += 1;
    onProgress?.(done, clipIds.length);
  }

  return result;
}
