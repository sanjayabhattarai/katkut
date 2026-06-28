import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { VideoAnalysis } from '../native';
import { AnalysisClip, Edl, selectTimeline, VIBES, AUTO } from '../core';
import { generateProxies } from './proxies';
import { PickedClip } from './types';

export interface ProcessingScreenProps {
  clips: PickedClip[];
  /** vibe chosen in the selector sheet — drives the scoring weights */
  vibeId: string;
  onDone: (analyses: AnalysisClip[], edl: Edl, proxies: Map<string, string>) => void;
}

// Mechanical, honest copy describing what the on-device engine is doing — cycles on a timer.
const PHASES = [
  'Analyzing clip structures…',
  'Finding the best visual moments…',
  'Filtering audio waveforms…',
  'Creating your rough-cut timeline…',
];

export default function ProcessingScreen({ clips, vibeId, onDone }: ProcessingScreenProps) {
  const [progress, setProgress] = useState(0); // 0..1 real analysis progress
  const [phase, setPhase] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  const barW = useRef(new Animated.Value(0)).current;

  // cycle the copy independently of real progress
  useEffect(() => {
    const id = setInterval(() => setPhase((p) => (p + 1) % PHASES.length), 1400);
    return () => clearInterval(id);
  }, []);

  // animate the bar toward the real progress value
  useEffect(() => {
    Animated.timing(barW, {
      toValue: progress,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [progress, barW]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      const analyses: AnalysisClip[] = [];
      try {
        // analysis takes the first ~80% of the bar
        for (let i = 0; i < clips.length; i++) {
          setProgress(clips.length ? (i / clips.length) * 0.8 : 0);
          const result = await VideoAnalysis.analyze(clips[i].uri, clips[i].clipId);
          analyses.push(result);
        }
        setProgress(0.8);
        const vibe = VIBES[vibeId] ?? AUTO;
        const edl = selectTimeline(analyses, vibe);

        // build low-res preview proxies for the keepers (last ~20% of the bar) so the
        // preview plays gaplessly; export still uses the full-res originals
        const proxies = await generateProxies(analyses, edl, (d, t) =>
          setProgress(0.8 + (t ? (d / t) * 0.2 : 0.2)),
        );
        setProgress(1);
        onDone(analyses, edl, proxies);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [clips, vibeId, onDone]);

  if (error) {
    return (
      <View style={styles.root}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }

  const width = barW.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <View style={styles.root}>
      <View style={styles.ring}>
        <Text style={styles.ringPct}>{Math.round(progress * 100)}%</Text>
      </View>
      <Text style={styles.phase}>{PHASES[phase]}</Text>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, { width }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', gap: 22, padding: 32 },
  ring: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 4,
    borderColor: '#3478f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringPct: { color: '#fff', fontSize: 26, fontWeight: '700', fontVariant: ['tabular-nums'] },
  phase: { color: '#ddd', fontSize: 16, textAlign: 'center', minHeight: 22 },
  track: {
    width: '80%',
    height: 4,
    borderRadius: 2,
    backgroundColor: '#222',
    overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: '#3478f6', borderRadius: 2 },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  error: { color: '#ff6b6b', textAlign: 'center', marginTop: 10 },
});
