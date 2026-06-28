import { AnalysisClip } from '../core';

export function uriMapFromAnalyses(analyses: AnalysisClip[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const a of analyses) {
    if (a.uri) map.set(a.clipId, a.uri);
  }
  return map;
}
