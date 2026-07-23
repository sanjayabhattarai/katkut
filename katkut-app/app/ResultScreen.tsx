import React, { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Info, MoreHorizontal, Pause, Pencil, Play, Sparkles, Wand2, X, LucideIcon } from 'lucide-react-native';
import EdlPlayer, { EdlPlayerHandle } from './EdlPlayer';
import { uriMapFromAnalyses } from './resultEdl';
import { AnalysisClip, Edl } from '../core';
import { space } from './theme';
import PressableScale from './components/PressableScale';

export interface ResultScreenProps {
  analyses: AnalysisClip[];
  edl: Edl;
  /** clipId → low-res preview proxy (preview only; missing entries fall back to the original) */
  proxyByClipId?: Map<string, string>;
  /** shown when there wasn't enough footage to reach the requested length */
  notice?: { requested: number; actual: number } | null;
  onExport: () => void;
  onEdit: () => void;
  onRegenerate: () => void;
  onClose: () => void;
}

function GhostAction({
  icon: Icon,
  label,
  tint,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  tint?: string;
  onPress: () => void;
}) {
  return (
    <PressableScale style={styles.ghost} onPress={onPress}>
      <Icon size={22} color={tint ?? '#A1A1AA'} strokeWidth={2} />
      <Text style={[styles.ghostLabel, tint ? { color: tint, fontWeight: '700' } : null]}>{label}</Text>
    </PressableScale>
  );
}

const BRAND_GRADIENT = ['#9B51E0', '#00C6FF'] as const;

export default function ResultScreen({
  analyses,
  edl,
  proxyByClipId,
  notice,
  onExport,
  onEdit,
  onRegenerate,
  onClose,
}: ResultScreenProps) {
  const insets = useSafeAreaInsets();
  const playerRef = useRef<EdlPlayerHandle>(null);
  const [playing, setPlaying] = useState(true);

  const uriByClipId = useMemo(() => {
    const m = uriMapFromAnalyses(analyses);
    if (proxyByClipId) for (const [clipId, uri] of proxyByClipId) m.set(clipId, uri);
    return m;
  }, [analyses, proxyByClipId]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.xs, paddingBottom: insets.bottom + space.md }]}>
      {/* top bar */}
      <View style={styles.topBar}>
        <Pressable hitSlop={10} onPress={onClose} style={styles.iconBtn}>
          <X size={24} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.title}>Your reel</Text>
        <Pressable hitSlop={10} style={styles.iconBtn}>
          <MoreHorizontal size={24} color="#FFFFFF" />
        </Pressable>
      </View>

      {/* not-enough-footage notice */}
      {notice && (
        <View style={styles.notice}>
          <LinearGradient
            colors={['rgba(155,81,224,0.12)', 'rgba(0,198,255,0.02)'] as const}
            style={styles.absoluteFill}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          />
          <Sparkles size={16} color="#00C6FF" strokeWidth={2.5} />
          <Text style={styles.noticeText}>
            Not enough footage for a {notice.requested}s edit — KatKut optimized it to a tight{' '}
            <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>{Math.round(notice.actual)}s</Text>.
          </Text>
        </View>
      )}

      {/* centered 9:16 preview */}
      <View style={styles.previewWrap}>
        <View style={styles.preview}>
          <EdlPlayer
            ref={playerRef}
            edl={edl}
            uriByClipId={uriByClipId}
            fill
            loop
            onPlayingChange={setPlaying}
          />
          <Pressable style={styles.tapZone} onPress={() => playerRef.current?.togglePlay()}>
            <View style={[styles.playBadge, !playing && styles.playBadgePaused]}>
              {playing ? (
                <Pause size={26} color="#FFFFFF" fill="#FFFFFF" />
              ) : (
                <Play size={26} color="#FFFFFF" fill="#FFFFFF" style={{ marginLeft: 3 }} />
              )}
            </View>
          </Pressable>
        </View>
      </View>

      {/* actions below the preview */}
      <View style={styles.actions}>
        <View style={styles.qualityNoteRow}>
          <Info size={12} color="#71717A" strokeWidth={2} />
          <Text style={styles.qualityNoteText}>
            Don't worry! Preview quality may be reduced for smooth processing, your final export
            will be full HD.
          </Text>
        </View>

        {/* Modernized Primary Gradient CTA Action Button */}
        <PressableScale style={styles.exportButtonContainer} onPress={onExport}>
          <LinearGradient
            colors={BRAND_GRADIENT}
            style={styles.exportGradientBtn}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            <Text style={styles.exportButtonText}>Continue</Text>
          </LinearGradient>
        </PressableScale>

        <View style={styles.ghostRow}>
          <GhostAction icon={Pencil} label="Edit" onPress={onEdit} />
          <GhostAction icon={Wand2} label="Regenerate" tint="#00C6FF" onPress={onRegenerate} />
          <GhostAction
            icon={playing ? Pause : Play}
            label={playing ? "Pause" : "Preview"}
            onPress={() => playerRef.current?.togglePlay()}
          />
        </View>
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
  root: {
    flex: 1,
    backgroundColor: '#09090B',
    paddingHorizontal: space.md
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: space.sm,
  },
  iconBtn: { 
    width: 44, 
    height: 44, 
    borderRadius: 22,
    backgroundColor: '#141417',
    alignItems: 'center', 
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)'
  },
  title: { 
    fontSize: 17,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: '#141417',
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: space.md,
    marginBottom: space.sm,
    borderWidth: 1.5,
    borderColor: 'rgba(0, 198, 255, 0.15)',
    overflow: 'hidden',
    position: 'relative'
  },
  noticeText: { 
    fontSize: 13, 
    color: '#A1A1AA', 
    flex: 1,
    lineHeight: 18,
    fontWeight: '500'
  },
  previewWrap: { 
    flex: 1, 
    alignItems: 'center', 
    justifyContent: 'center', 
    overflow: 'hidden' 
  },
  preview: {
    height: '100%',
    aspectRatio: 9 / 16,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: '#000000',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.65,
    shadowRadius: 32,
    elevation: 16,
  },
  tapZone: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBadge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(20, 20, 23, 0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0,
  },
  playBadgePaused: {
    opacity: 1,
    backgroundColor: 'rgba(20, 20, 23, 0.9)',
    transform: [{ scale: 1.05 }],
  },
  actions: { 
    paddingTop: space.lg, 
    gap: space.md 
  },
  qualityNoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: space.md,
  },
  qualityNoteText: {
    fontSize: 11,
    color: '#71717A',
    textAlign: 'center',
    flexShrink: 1,
  },
  exportButtonContainer: {
    alignSelf: 'center',
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#9B51E0',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 6,
  },
  exportGradientBtn: {
    height: 46,
    paddingHorizontal: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  exportButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  ghostRow: { 
    flexDirection: 'row', 
    justifyContent: 'space-around' 
  },
  ghost: { 
    alignItems: 'center', 
    gap: space.xs, 
    paddingVertical: space.sm, 
    paddingHorizontal: space.md 
  },
  ghostLabel: { 
    fontSize: 12, 
    color: '#71717A',
    fontWeight: '600'
  },
});