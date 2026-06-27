import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import PickScreen from './app/PickScreen';
import ProcessingScreen from './app/ProcessingScreen';
import { PickedClip } from './app/types';
import { exportReel, ExportResult } from './app/exportReel';
import { saveToGallery, shareReel } from './app/share';
import { AnalysisClip, Edl } from './core';

type ExportState =
  | { kind: 'idle' }
  | { kind: 'exporting' }
  | { kind: 'done'; result: ExportResult }
  | { kind: 'error'; message: string };

type Screen = 'pick' | 'processing' | 'result';

export default function App() {
  const [screen, setScreen] = useState<Screen>('pick');
  const [clips, setClips] = useState<PickedClip[]>([]);
  const [analyses, setAnalyses] = useState<AnalysisClip[]>([]);
  const [edl, setEdl] = useState<Edl | null>(null);
  const [exportState, setExportState] = useState<ExportState>({ kind: 'idle' });
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  function handleContinue(picked: PickedClip[]) {
    setClips(picked);
    setScreen('processing');
  }

  function handleDone(a: AnalysisClip[], e: Edl) {
    setAnalyses(a);
    setEdl(e);
    setScreen('result');
  }

  async function handleExport() {
    if (!edl) return;
    setExportState({ kind: 'exporting' });
    try {
      const result = await exportReel(edl, analyses);
      setExportState({ kind: 'done', result });
    } catch (e) {
      setExportState({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  async function handleSave() {
    if (exportState.kind !== 'done') return;
    setSaveMsg(null);
    try {
      await saveToGallery(exportState.result.outputPath);
      setSaveMsg('Saved to gallery ✓');
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleShare() {
    if (exportState.kind !== 'done') return;
    setSaveMsg(null);
    try {
      await shareReel(exportState.result.outputPath);
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : String(e));
    }
  }

  function reset() {
    setClips([]);
    setAnalyses([]);
    setEdl(null);
    setExportState({ kind: 'idle' });
    setSaveMsg(null);
    setScreen('pick');
  }

  return (
    <View style={styles.root}>
      {screen === 'pick' && <PickScreen onContinue={handleContinue} />}

      {screen === 'processing' && (
        <ProcessingScreen clips={clips} onDone={handleDone} />
      )}

      {screen === 'result' && edl && (
        // Temporary debug result (Slice 1C verification). Real Result screen is Phase 3.
        <ScrollView contentContainerStyle={styles.result}>
          <Text style={styles.h1}>EDL</Text>
          <Text style={styles.meta}>
            vibe: {edl.vibe} · target: {edl.targetDuration}s · audio: {edl.audioMode}
          </Text>
          <Text style={styles.meta}>
            kept {edl.timeline.length} / {analyses.length} clips
          </Text>
          {edl.timeline.map((t) => (
            <Text key={t.clipId} style={styles.mono}>
              {t.clipId}: {t.in.toFixed(1)}–{t.out.toFixed(1)}s{t.muted ? ' (muted)' : ''}
            </Text>
          ))}

          <Text style={[styles.h1, styles.spacer]}>Analysis summary</Text>
          {analyses.map((c) => {
            const rms = c.windows.map((w) => w.audioRMS);
            const meanRms = rms.length
              ? Math.round((rms.reduce((a, b) => a + b, 0) / rms.length) * 10) / 10
              : null;
            return (
              <Text key={c.clipId} style={styles.mono}>
                {c.clipId} · {c.orientation} · {c.duration}s · {c.windows.length}w · cuts:
                {c.sceneCuts.length} · audio:{meanRms ?? '—'}dB
              </Text>
            );
          })}

          <View style={styles.spacer}>
            {exportState.kind === 'exporting' ? (
              <View style={styles.exportRow}>
                <ActivityIndicator />
                <Text style={styles.meta}>Exporting 1080×1920 MP4…</Text>
              </View>
            ) : (
              <Button
                title="Export reel"
                onPress={handleExport}
                disabled={edl.timeline.length === 0}
              />
            )}
            {exportState.kind === 'done' && (
              <View style={styles.spacer}>
                <Text style={styles.h1}>Exported ✓</Text>
                <Text style={styles.mono}>
                  {exportState.result.probed.width}×{exportState.result.probed.height} ·{' '}
                  {(exportState.result.probed.durationMs / 1000).toFixed(1)}s
                </Text>
                <View style={styles.btnRow}>
                  <Button title="Save to gallery" onPress={handleSave} />
                  <Button title="Share" onPress={handleShare} />
                </View>
                {saveMsg && <Text style={styles.meta}>{saveMsg}</Text>}
              </View>
            )}
            {exportState.kind === 'error' && (
              <Text style={styles.error}>{exportState.message}</Text>
            )}
          </View>

          <View style={styles.spacer}>
            <Button title="Start over" onPress={reset} />
          </View>
        </ScrollView>
      )}

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#fff',
  },
  result: {
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 32,
    gap: 4,
  },
  h1: {
    fontSize: 20,
    fontWeight: '700',
  },
  spacer: {
    marginTop: 20,
  },
  meta: {
    color: '#555',
  },
  mono: {
    fontFamily: 'monospace',
    fontSize: 12,
  },
  exportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 8,
  },
  error: {
    color: 'red',
  },
});
