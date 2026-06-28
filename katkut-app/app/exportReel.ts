import { File, Paths } from 'expo-file-system';
import { VideoAssembler, MediaProbe, MediaProbeResult } from '../native';
import { AnalysisClip, Edl } from '../core';

export interface ExportResult {
  outputPath: string;
  probed: MediaProbeResult;
}

/** Assemble the EDL into a 1080x1920 MP4 in the cache dir, then probe it to confirm validity. */
export async function exportReel(edl: Edl, analyses: AnalysisClip[]): Promise<ExportResult> {
  const uriByClipId = new Map<string, string>();
  for (const a of analyses) {
    if (a.uri) uriByClipId.set(a.clipId, a.uri);
  }

  const segments = edl.timeline.map((t) => {
    const uri = uriByClipId.get(t.clipId);
    if (!uri) throw new Error(`No source URI for ${t.clipId}`);
    return { uri, inSec: t.in, outSec: t.out, muted: t.muted };
  });

  const outFile = new File(Paths.cache, `katkut_${Date.now()}.mp4`);
  // Audio is per-clip now (no global toggle): 'smart' tells native to honor each clip's muted flag.
  const { outputPath } = await VideoAssembler.assemble(segments, outFile.uri, 'smart');
  const probed = await MediaProbe.probe(outputPath);
  return { outputPath, probed };
}
