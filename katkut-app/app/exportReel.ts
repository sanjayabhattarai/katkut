import { File, Paths } from 'expo-file-system';
import { VideoAssembler, MediaProbe, MediaProbeResult, ExportResolution } from '../native';
import { AnalysisClip, Edl } from '../core';
import { renderPhotoClip } from './photoClips';

export interface ExportResult {
  outputPath: string;
  probed: MediaProbeResult;
}

/** Assemble the EDL into an MP4 in the cache dir, then probe it to confirm validity.
 * resolution defaults to full-quality 1080x1920; '720p' is the fast-export option.
 * isPro (HARD RULE 6): free exports carry the watermark, Pro removes it — caller passes account
 * entitlement (services/entitlement.ts), this just decides applyWatermark = !isPro. */
export async function exportReel(
  edl: Edl,
  analyses: AnalysisClip[],
  resolution: ExportResolution = '1080p',
  isPro: boolean = false,
): Promise<ExportResult> {
  const uriByClipId = new Map<string, string>();
  for (const a of analyses) {
    if (a.uri) uriByClipId.set(a.clipId, a.uri);
  }

  // Export canvas: full 1080x1920 (HARD RULE 2), or 720x1280 for the fast option.
  const dims = resolution === '720p' ? { w: 720, h: 1280 } : { w: 1080, h: 1920 };

  // Build segments in order. Photos are pre-rendered into a matching-resolution MP4 (still + motion)
  // so the existing concat path handles them like any video clip. Rendered sequentially — one
  // hardware encoder at a time.
  const segments: { uri: string; inSec: number; outSec: number; muted: boolean }[] = [];
  for (const t of edl.timeline) {
    const uri = uriByClipId.get(t.clipId);
    if (!uri) throw new Error(`No source URI for ${t.clipId}`);
    if (t.kind === 'photo') {
      const clipPath = await renderPhotoClip(t, uri, dims.w, dims.h);
      segments.push({ uri: clipPath, inSec: 0, outSec: Math.max(0, t.out - t.in), muted: true });
    } else {
      segments.push({ uri, inSec: t.in, outSec: t.out, muted: t.muted });
    }
  }

  const outFile = new File(Paths.cache, `katkut_${Date.now()}.mp4`);
  // Audio is per-clip now (no global toggle): 'smart' tells native to honor each clip's muted flag.
  // The watermark (HARD RULE 6) is a fixed brand asset baked into the native module as an Android
  // resource — see Transcoder.kt — only whether to apply it crosses the bridge, not the asset itself.
  const { outputPath } = await VideoAssembler.assemble(segments, outFile.uri, 'smart', resolution, !isPro);
  const probed = await MediaProbe.probe(outputPath);
  return { outputPath, probed };
}
