import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Check, ChevronLeft, Sparkles } from 'lucide-react-native';
import { VIBE_CHOICES } from '../core';
import { space } from './theme';
import PressableScale from './components/PressableScale';

export interface LengthRange {
  min: number;
  max: number;
}

export type AudioMode = 'smart' | 'muteAll' | 'unmuteAll';

export interface OptionsScreenProps {
  vibeId: string;
  onBack: () => void;
  onGenerate: (length: LengthRange, audioMode: AudioMode) => void;
}

const LENGTH_OPTIONS: { id: string; label: string; min: number; max: number }[] = [
  { id: 's0', label: 'Up to 30s', min: 0, max: 30 },
  { id: 's30', label: '30–60s', min: 30, max: 60 },
  { id: 's60', label: '60–90s', min: 60, max: 90 },
  { id: 's90', label: '90–120s', min: 90, max: 120 },
  { id: 's120', label: '120s +', min: 120, max: 300 },
];

// expo-linear-gradient's `colors` prop requires a fixed-length tuple, not a plain string[].
const BRAND_GRADIENT = ['#9B51E0', '#00C6FF'] as const;

export default function OptionsScreen({ vibeId, onBack, onGenerate }: OptionsScreenProps) {
  const insets = useSafeAreaInsets();
  const [lengthId, setLengthId] = useState('s30');
  const [audioMode, setAudioMode] = useState<AudioMode>('smart'); // default: Let KatKut AI decide

  const vibeLabel = VIBE_CHOICES.find((v) => v.id === vibeId)?.label ?? 'Auto';

  function handleGenerate() {
    const opt = LENGTH_OPTIONS.find((o) => o.id === lengthId) ?? LENGTH_OPTIONS[1];
    onGenerate({ min: opt.min, max: opt.max }, audioMode);
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + space.md }]}>
      {/* Header */}
      <View style={styles.header}>
        <PressableScale hitSlop={12} onPress={onBack} style={styles.backButton}>
          <ChevronLeft size={22} color="#FFFFFF" strokeWidth={2.5} />
        </PressableScale>
        <View style={styles.badgeWrapper}>
          <Text style={styles.stepIndicator}>3 of 3</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {/* Title Section */}
      <View style={styles.titleSection}>
        <Text style={styles.title}>Almost there</Text>
        <Text style={styles.subtitle}>Set final length and audio for your {vibeLabel} reel.</Text>
      </View>

      <View style={styles.contentBody}>
        {/* Length Card */}
        <View style={styles.cardGroup}>
          <Text style={styles.sectionLabel}>Target Duration</Text>
          <View style={styles.lengthWrap}>
            {LENGTH_OPTIONS.map((opt) => {
              const active = lengthId === opt.id;
              return (
                <PressableScale
                  key={opt.id}
                  onPress={() => setLengthId(opt.id)}
                  style={[styles.lengthPill, active && styles.lengthPillActive]}
                >
                  {active && (
                    <LinearGradient
                      colors={['rgba(0,198,255,0.12)', 'rgba(155,81,224,0.02)'] as const}
                      style={StyleSheet.absoluteFill}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                    />
                  )}
                  <Text style={[styles.lengthText, active && styles.lengthTextActive]}>{opt.label}</Text>
                </PressableScale>
              );
            })}
          </View>
        </View>

        {/* Audio Card */}
        <View style={styles.cardGroup}>
          <Text style={styles.sectionLabel}>Mute all clips?</Text>
          <View style={styles.muteList}>
            <PressableScale
              onPress={() => setAudioMode('smart')}
              style={[styles.muteOption, audioMode === 'smart' && styles.muteOptionActive]}
            >
              {audioMode === 'smart' && (
                <LinearGradient
                  colors={['rgba(0,198,255,0.14)', 'rgba(155,81,224,0.02)'] as const}
                  style={StyleSheet.absoluteFill}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                />
              )}
              <View style={styles.muteTextBlock}>
                <Text style={[styles.muteText, audioMode === 'smart' && styles.muteTextActive]}>Let KatKut AI decide</Text>
                <Text style={styles.muteSubtext}>Keeps loud, meaningful moments — mutes the rest</Text>
              </View>
              <View style={[styles.radio, audioMode === 'smart' && styles.radioActive]}>
                {audioMode === 'smart' && <Check size={13} color="#09090B" strokeWidth={3.5} />}
              </View>
            </PressableScale>

            <PressableScale
              onPress={() => setAudioMode('muteAll')}
              style={[styles.muteOption, audioMode === 'muteAll' && styles.muteOptionActive]}
            >
              {audioMode === 'muteAll' && (
                <LinearGradient
                  colors={['rgba(0,198,255,0.14)', 'rgba(155,81,224,0.02)'] as const}
                  style={StyleSheet.absoluteFill}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                />
              )}
              <View style={styles.muteTextBlock}>
                <Text style={[styles.muteText, audioMode === 'muteAll' && styles.muteTextActive]}>Yes, mute all</Text>
                <Text style={styles.muteSubtext}>Silent — you'll add your own voiceover or music</Text>
              </View>
              <View style={[styles.radio, audioMode === 'muteAll' && styles.radioActive]}>
                {audioMode === 'muteAll' && <Check size={13} color="#09090B" strokeWidth={3.5} />}
              </View>
            </PressableScale>

            <PressableScale
              onPress={() => setAudioMode('unmuteAll')}
              style={[styles.muteOption, audioMode === 'unmuteAll' && styles.muteOptionActive]}
            >
              {audioMode === 'unmuteAll' && (
                <LinearGradient
                  colors={['rgba(0,198,255,0.14)', 'rgba(155,81,224,0.02)'] as const}
                  style={StyleSheet.absoluteFill}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                />
              )}
              <View style={styles.muteTextBlock}>
                <Text style={[styles.muteText, audioMode === 'unmuteAll' && styles.muteTextActive]}>No, keep all</Text>
                <Text style={styles.muteSubtext}>Every clip keeps its original sound</Text>
              </View>
              <View style={[styles.radio, audioMode === 'unmuteAll' && styles.radioActive]}>
                {audioMode === 'unmuteAll' && <Check size={13} color="#09090B" strokeWidth={3.5} />}
              </View>
            </PressableScale>
          </View>
        </View>
      </View>

      {/* Generate */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + space.lg }]}>
        <PressableScale style={styles.generateButtonContainer} onPress={handleGenerate}>
          <LinearGradient
            colors={BRAND_GRADIENT}
            style={styles.generateGradientBtn}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            <Sparkles size={18} color="#FFFFFF" strokeWidth={2.5} />
            <Text style={styles.generateText}>Generate Reel</Text>
          </LinearGradient>
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090B',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    marginBottom: space.md,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#141417',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  badgeWrapper: {
    backgroundColor: '#141417',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
  },
  stepIndicator: {
    fontSize: 12,
    fontWeight: '700',
    color: '#71717A',
    letterSpacing: 0.5,
  },
  headerSpacer: { width: 44 },
  titleSection: {
    paddingHorizontal: space.xl,
    marginBottom: space.xl,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.6,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#71717A',
    lineHeight: 20,
    fontWeight: '500',
  },
  contentBody: {
    paddingHorizontal: space.xl,
    gap: 20,
  },
  cardGroup: {
    backgroundColor: '#141417',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.04)',
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 14,
    letterSpacing: -0.1,
  },
  lengthWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  lengthPill: {
    paddingHorizontal: 16,
    height: 44,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.04)',
    backgroundColor: '#0C0C0E',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  lengthPillActive: {
    borderColor: '#00C6FF',
  },
  lengthText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  lengthTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  muteList: {
    gap: 10,
  },
  muteOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.04)',
    backgroundColor: '#0C0C0E',
    overflow: 'hidden',
  },
  muteOptionActive: {
    borderColor: '#00C6FF',
  },
  muteTextBlock: {
    flex: 1,
    gap: 3,
  },
  muteText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  muteTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  muteSubtext: {
    fontSize: 12,
    color: '#52525B',
    fontWeight: '500',
    lineHeight: 16,
  },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#3A3A40',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: {
    borderColor: '#00C6FF',
    backgroundColor: '#00C6FF',
  },
  footer: {
    marginTop: 'auto',
    paddingHorizontal: space.xl,
  },
  generateButtonContainer: {
    borderRadius: 30,
    overflow: 'hidden',
    shadowColor: '#00C6FF',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 6,
  },
  generateGradientBtn: {
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  generateText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
});
