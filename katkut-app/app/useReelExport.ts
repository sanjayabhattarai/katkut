import { useState } from 'react';
import { exportReel, ExportResult } from './exportReel';
import { saveToGallery, shareReel } from './share';
import { AnalysisClip, Edl } from '../core';

export type ExportState =
  | { kind: 'idle' }
  | { kind: 'exporting' }
  | { kind: 'done'; result: ExportResult }
  | { kind: 'error'; message: string };

/** Shared export/save/share state machine for the editor page. */
export function useReelExport(analyses: AnalysisClip[]) {
  const [state, setState] = useState<ExportState>({ kind: 'idle' });
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  async function exportNow(edl: Edl) {
    setState({ kind: 'exporting' });
    setSaveMsg(null);
    try {
      const result = await exportReel(edl, analyses);
      setState({ kind: 'done', result });
    } catch (e) {
      setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  async function save() {
    if (state.kind !== 'done') return;
    setSaveMsg(null);
    try {
      await saveToGallery(state.result.outputPath);
      setSaveMsg('Saved to gallery ✓');
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : String(e));
    }
  }

  async function share() {
    if (state.kind !== 'done') return;
    setSaveMsg(null);
    try {
      await shareReel(state.result.outputPath);
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : String(e));
    }
  }

  function dismiss() {
    setState({ kind: 'idle' });
    setSaveMsg(null);
  }

  return { state, saveMsg, exportNow, save, share, dismiss };
}
