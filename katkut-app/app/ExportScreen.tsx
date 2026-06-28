import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Button, Pressable, StyleSheet, Text, View } from 'react-native';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { exportReel } from './exportReel';
import { saveToGallery, shareReel } from './share';
import { AnalysisClip, Edl } from '../core';
import { saveDraft, markExported } from '../services';

export interface ExportScreenProps {
  analyses: AnalysisClip[];
  edl: Edl;
  vibeId: string;
  projectId: string;
  onDone: () => void;
  onCancel: () => void;
}

type Phase =
  | { kind: 'running'; label: string }
  | { kind: 'done'; outputPath: string }
  | { kind: 'error'; message: string };

// TODO(monetization, Rule 6 "ads later"): swap this stub for a real full-screen ad SDK.
// Native rebuild + ad account required; kept as a hook so the export flow already calls it.
async function showAdStub(): Promise<void> {
  await new Promise((r) => setTimeout(r, 800));
}

export default function ExportScreen({
  analyses,
  edl,
  vibeId,
  projectId,
  onDone,
  onCancel,
}: ExportScreenProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'running', label: 'Preparing…' });
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const startedRef = useRef(false);

  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 1200, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      try {
        await showAdStub();

        setPhase({ kind: 'running', label: 'Compiling 1080×1920 MP4…' });
        const { outputPath } = await exportReel(edl, analyses);

        setPhase({ kind: 'running', label: 'Saving to gallery…' });
        await saveToGallery(outputPath);

        // promote the project into the library (Previous Edits)
        let thumbUri: string | undefined;
        try {
          const t = await VideoThumbnails.getThumbnailAsync(outputPath, { time: 0 });
          thumbUri = t.uri;
        } catch {
          // best-effort thumbnail
        }
        await saveDraft({ id: projectId, vibeId, edl, analyses, thumbUri });
        await markExported(projectId, outputPath);

        setPhase({ kind: 'done', outputPath });
      } catch (e) {
        setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    })();
  }, [edl, analyses, vibeId, projectId]);

  async function handleShare(outputPath: string) {
    setSaveMsg(null);
    try {
      await shareReel(outputPath);
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : String(e));
    }
  }

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={styles.root}>
      {phase.kind === 'running' && (
        <>
          <Animated.View style={[styles.ring, { transform: [{ rotate }] }]} />
          <Text style={styles.label}>{phase.label}</Text>
          <ActivityIndicator color="#3478f6" />
        </>
      )}

      {phase.kind === 'done' && (
        <>
          <Text style={styles.check}>✓</Text>
          <Text style={styles.title}>Saved to your gallery</Text>
          <Text style={styles.sub}>Finish it in TikTok, Instagram or CapCut.</Text>
          <View style={styles.row}>
            <Button title="Share" onPress={() => handleShare(phase.outputPath)} />
            <Button title="Done" onPress={onDone} />
          </View>
          {saveMsg && <Text style={styles.sub}>{saveMsg}</Text>}
        </>
      )}

      {phase.kind === 'error' && (
        <>
          <Text style={styles.title}>Export failed</Text>
          <Text style={styles.sub}>{phase.message}</Text>
          <View style={styles.row}>
            <Pressable style={styles.retryBtn} onPress={onCancel}>
              <Text style={styles.retryText}>Back</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', gap: 18, padding: 32 },
  ring: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 4,
    borderColor: '#3478f6',
    borderTopColor: 'transparent',
  },
  label: { color: '#ddd', fontSize: 16, textAlign: 'center' },
  check: { color: '#3478f6', fontSize: 56, fontWeight: '800' },
  title: { color: '#fff', fontSize: 20, fontWeight: '700' },
  sub: { color: '#999', fontSize: 13, textAlign: 'center' },
  row: { flexDirection: 'row', gap: 20, marginTop: 8 },
  retryBtn: { backgroundColor: '#222', borderRadius: 12, paddingHorizontal: 22, paddingVertical: 10 },
  retryText: { color: '#fff', fontWeight: '700' },
});
