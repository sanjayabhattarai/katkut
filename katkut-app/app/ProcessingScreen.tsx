import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  withSequence,
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Sparkles } from 'lucide-react-native';
import { VideoAnalysis } from '../native';
import { AnalysisClip, Edl, PhotoRef, PHOTO_DURATION, buildReel } from '../core';
import { generateProxies } from './proxies';
import { AudioMode } from './OptionsScreen';
import { PickedClip } from './types';
import { space } from './theme';

function photoAnalysisClip(p: PickedClip): AnalysisClip {
  const orientation =
    p.width != null && p.height != null
      ? p.width > p.height
        ? 'landscape'
        : p.width < p.height
          ? 'portrait'
          : 'square'
      : 'portrait';
  return { clipId: p.clipId, duration: PHOTO_DURATION, orientation, sceneCuts: [], windows: [], uri: p.uri };
}

export interface ProcessingScreenProps {
  clips: PickedClip[];
  vibeId: string;
  lengthRange?: { min: number; max: number } | null;
  audioMode?: AudioMode;
  onDone: (analyses: AnalysisClip[], edl: Edl, proxies: Map<string, string>) => void;
}

const STATUS_MESSAGES = [
  'Analyzing your clips...',
  'Detecting best moments...',
  'Creating smooth transitions...',
  'Syncing audio beats...',
  'Finalizing your edit...',
];

const BRAND_GRADIENT = ['#9B51E0', '#00C6FF'] as const;

export default function ProcessingScreen({
  clips,
  vibeId,
  lengthRange,
  audioMode = 'smart',
  onDone,
}: ProcessingScreenProps) {
  const [progress, setProgress] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);
  const messageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Core Pulse Scaling & Opacity Values
  const pulseScale = useSharedValue(1);
  const coreRotate = useSharedValue(0);

  useEffect(() => {
    pulseScale.value = withRepeat(
      withSequence(
        withTiming(1.15, { duration: 1800 }),
        withTiming(0.95, { duration: 1800 })
      ),
      -1,
      true
    );

    coreRotate.value = withRepeat(
      withTiming(360, { duration: 8000 }),
      -1,
      false
    );
  }, []);

  const animatedOrbStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
  }));

  const animatedIconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${coreRotate.value}deg` }],
  }));

  useEffect(() => {
    messageTimerRef.current = setInterval(() => {
      setMessageIndex(prev => (prev + 1) % STATUS_MESSAGES.length);
    }, 2500);

    return () => {
      if (messageTimerRef.current) clearInterval(messageTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      const videos = clips.filter((c) => c.kind !== 'photo');
      const photoClips = clips.filter((c) => c.kind === 'photo');
      const analyses: AnalysisClip[] = [];
      try {
        setProgress(0.05);
        setStatusText('Reading your clips...');

        for (let i = 0; i < videos.length; i++) {
          setProgress(0.05 + (i / Math.max(1, videos.length)) * 0.6);
          setStatusText(`Processing clip ${i + 1} of ${videos.length}...`);
          const result = await VideoAnalysis.analyze(videos[i].uri, videos[i].clipId);
          analyses.push(result);
        }

        setProgress(0.65);
        setStatusText('AI is watching your videos...');
        const length = lengthRange ?? { min: 30, max: 60 };
        const photos: PhotoRef[] = photoClips.map((p) => ({ clipId: p.clipId, uri: p.uri }));
        const allAnalyses = [...analyses, ...photoClips.map(photoAnalysisClip)];

        await new Promise(r => setTimeout(r, 800));

        setProgress(0.72);
        setStatusText('Designing the timeline...');
        const selected = buildReel(analyses, vibeId, { lengthMin: length.min, lengthMax: length.max }, photos);
        const edl =
          audioMode === 'muteAll'
            ? { ...selected, timeline: selected.timeline.map((t) => ({ ...t, muted: true })) }
            : audioMode === 'unmuteAll'
              ? { ...selected, timeline: selected.timeline.map((t) => ({ ...t, muted: false })) }
              : selected;

        await new Promise(r => setTimeout(r, 600));

        setProgress(0.78);
        setStatusText('Rendering previews...');
        const proxies = await generateProxies(allAnalyses, edl, (d, n) =>
          setProgress(0.78 + (n ? (d / n) * 0.22 : 0.22)),
        );
        
        setProgress(1);
        setStatusText('Finalizing...');
        
        if (messageTimerRef.current) clearInterval(messageTimerRef.current);
        
        setTimeout(() => {
          onDone(allAnalyses, edl, proxies);
        }, 600);
        
      } catch (e) {
        if (messageTimerRef.current) clearInterval(messageTimerRef.current);
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [clips, vibeId, lengthRange, audioMode, onDone]);

  if (error) {
    return (
      <View style={styles.container}>
        <View style={styles.errorCard}>
          <View style={styles.errorRing}>
            <Text style={styles.errorExclaim}>!</Text>
          </View>
          <Text style={styles.errorTitle}>Analysis Halted</Text>
          <Text style={styles.errorMessage}>{error}</Text>
        </View>
      </View>
    );
  }

  const percentage = Math.round(progress * 100);

  return (
    <View style={styles.container}>
      {/* Premium Multi-Layer Orb Section */}
      <View style={styles.orbSection}>
        <Animated.View style={[styles.absoluteFill, animatedOrbStyle]}>
          <LinearGradient
            colors={['rgba(155,81,224,0.18)', 'rgba(0,198,255,0.03)']}
            style={styles.outerGlowRing}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          />
        </Animated.View>

        <View style={styles.coreOrb}>
          <LinearGradient
            colors={['#1C1C21', '#141417']}
            style={styles.absoluteFill}
          />
          <Animated.View style={animatedIconStyle}>
            <Sparkles size={32} color="#00C6FF" strokeWidth={2} />
          </Animated.View>
        </View>
      </View>

      {/* Primary Context Header Text */}
      <Text style={styles.title}>Assembling Studio Cut</Text>
      
      {/* Cycling Secondary Prompt Block */}
      <Text style={styles.subtitle}>
        {STATUS_MESSAGES[messageIndex]}
      </Text>

      {/* Micro Progress Metrics Track */}
      <View style={styles.progressBarContainer}>
        <View style={styles.progressHeader}>
          <Animated.View key={statusText} entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)}>
            <Text style={styles.bottomStatus}>{statusText}</Text>
          </Animated.View>
          <Text style={styles.percentText}>{percentage}%</Text>
        </View>
        <View style={styles.progressBarBg}>
          <LinearGradient
            colors={BRAND_GRADIENT}
            style={[styles.progressBarFill, { width: `${percentage}%` }]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          />
        </View>
      </View>

      {/* Activity Indicator Bottom Lock */}
      <View style={styles.activityIndicatorRow}>
        <ActivityIndicator size="small" color="#00C6FF" style={{ transform: [{ scale: 0.8 }] }} />
        <Text style={styles.keepOpenText}>Please do not close the app</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  absoluteFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  container: {
    flex: 1,
    backgroundColor: '#09090B',
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
  orbSection: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 36,
    width: 140,
    height: 140,
    position: 'relative',
  },
  outerGlowRing: {
    flex: 1,
    borderRadius: 70,
    borderWidth: 1.5,
    borderColor: 'rgba(0, 198, 255, 0.08)',
  },
  coreOrb: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.06)',
    shadowColor: '#00C6FF',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#71717A',
    marginBottom: 40,
    textAlign: 'center',
    fontWeight: '600',
  },
  progressBarContainer: {
    width: '100%',
    maxWidth: 300,
    backgroundColor: '#141417',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
    marginBottom: 24,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  percentText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  progressBarBg: {
    height: 5,
    backgroundColor: '#27272A',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  bottomStatus: {
    fontSize: 12,
    color: '#A1A1AA',
    fontWeight: '500',
  },
  activityIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  keepOpenText: {
    fontSize: 12,
    color: '#52525B',
    fontWeight: '600',
  },
  errorCard: {
    backgroundColor: 'rgba(239, 68, 68, 0.04)',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.15)',
    alignItems: 'center',
    maxWidth: 320,
  },
  errorRing: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderWidth: 1.5,
    borderColor: 'rgba(239, 68, 68, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  errorExclaim: {
    fontSize: 22,
    fontWeight: '800',
    color: '#EF4444',
  },
  errorTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 6,
  },
  errorMessage: {
    fontSize: 13,
    color: 'rgba(239, 68, 68, 0.8)',
    textAlign: 'center',
    lineHeight: 18,
    fontWeight: '500',
  },
});