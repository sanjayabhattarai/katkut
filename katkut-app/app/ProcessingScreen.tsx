import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { VideoAnalysis } from '../native';
import { AnalysisClip, Edl, selectTimeline } from '../core';
import { PickedClip } from './types';

export interface ProcessingScreenProps {
  clips: PickedClip[];
  onDone: (analyses: AnalysisClip[], edl: Edl) => void;
}

type Status =
  | { kind: 'analyzing'; done: number; total: number; current: string }
  | { kind: 'selecting' }
  | { kind: 'error'; message: string };

export default function ProcessingScreen({ clips, onDone }: ProcessingScreenProps) {
  const [status, setStatus] = useState<Status>({
    kind: 'analyzing',
    done: 0,
    total: clips.length,
    current: '',
  });
  // Guard against double-run in React strict/dev re-mounts.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      const analyses: AnalysisClip[] = [];
      try {
        for (let i = 0; i < clips.length; i++) {
          const clip = clips[i];
          setStatus({
            kind: 'analyzing',
            done: i,
            total: clips.length,
            current: clip.clipId,
          });
          const result = await VideoAnalysis.analyze(clip.uri, clip.clipId);
          analyses.push(result);
        }
        setStatus({ kind: 'selecting' });
        const edl = selectTimeline(analyses);
        onDone(analyses, edl);
      } catch (e) {
        setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    })();
  }, [clips, onDone]);

  if (status.kind === 'error') {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Analysis failed</Text>
        <Text style={styles.error}>{status.message}</Text>
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" />
      {status.kind === 'analyzing' ? (
        <>
          <Text style={styles.title}>
            Analyzing clip {Math.min(status.done + 1, status.total)} of {status.total}
          </Text>
          <Text style={styles.sub}>{status.current}</Text>
        </>
      ) : (
        <Text style={styles.title}>Picking the good moments…</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
  sub: {
    color: '#777',
  },
  error: {
    color: 'red',
    textAlign: 'center',
  },
});
