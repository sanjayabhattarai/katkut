import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Rect, LinearGradient as SvgGradient, Stop } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { Check, ChevronLeft, Film, Download } from 'lucide-react-native';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { exportReel } from './exportReel';
import { saveToGallery, shareReel } from './share';
import { AnalysisClip, Edl } from '../core';
import { ExportResolution } from '../native';
import { saveDraft, markExported, getEntitlement } from '../services';
import { space } from './theme';
import PressableScale from './components/PressableScale';

export interface ExportScreenProps {
  analyses: AnalysisClip[];
  edl: Edl;
  vibeId: string;
  projectId: string;
  onDone: () => void;
  onCancel: () => void;
}

type Phase =
  | { kind: 'config' }
  | { kind: 'running'; label: string }
  | { kind: 'done'; outputPath: string }
  | { kind: 'error'; message: string };

const THUMB_W = 220;
const THUMB_H = (THUMB_W * 16) / 9;
const STROKE = 3.0;
const RECT_W = THUMB_W - STROKE;
const RECT_H = THUMB_H - STROKE;
const CORNER_R = 24;
const PERIMETER = 2 * (RECT_W - 2 * CORNER_R + RECT_H - 2 * CORNER_R) + 2 * Math.PI * CORNER_R;

// Brand Gradient Presets matched to katkutai_icon_512.png
const BRAND_GRADIENT = ['#9B51E0', '#00C6FF'] as const;
const DONE_GRADIENT = ['#00B09B', '#96C93D'] as const;

export default function ExportScreen({ analyses, edl, vibeId, projectId, onDone, onCancel }: ExportScreenProps) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>({ kind: 'config' });
  const [resolution, setResolution] = useState<ExportResolution>('1080p');
  const [prog, setProg] = useState(0);
  const [thumb, setThumb] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const rampRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const uri = analyses.find((a) => a.clipId === edl.timeline[0]?.clipId)?.uri;
    if (!uri) return;
    VideoThumbnails.getThumbnailAsync(uri, { time: 0 })
      .then((t) => setThumb(t.uri))
      .catch(() => {});
  }, [analyses, edl]);

  useEffect(() => () => {
    if (rampRef.current) clearInterval(rampRef.current);
  }, []);

  async function startExport() {
    setPhase({ kind: 'running', label: 'Preparing export...' });
    setProg(0);
    
    rampRef.current = setInterval(() => {
      setProg((p) => (p < 0.92 ? p + (0.92 - p) * 0.08 : p));
    }, 80);

    try {
      setPhase({ kind: 'running', label: 'Rendering video...' });
      // Checked fresh at export time (not cached from screen mount) so a subscription bought
      // moments ago in the browser and returned from is reflected immediately.
      const { isPro } = await getEntitlement();
      const { outputPath } = await exportReel(edl, analyses, resolution, isPro);

      setPhase({ kind: 'running', label: 'Saving to gallery...' });
      await saveToGallery(outputPath);

      let thumbUri: string | undefined = thumb ?? undefined;
      try {
        const t = await VideoThumbnails.getThumbnailAsync(outputPath, { time: 0 });
        thumbUri = t.uri;
      } catch {}
      
      await saveDraft({ id: projectId, vibeId, edl, analyses, thumbUri });
      await markExported(projectId, outputPath);

      if (rampRef.current) clearInterval(rampRef.current);
      setProg(1);
      setPhase({ kind: 'done', outputPath });
    } catch (e) {
      if (rampRef.current) clearInterval(rampRef.current);
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  async function handleShare(outputPath: string) {
    setSaveMsg(null);
    try {
      await shareReel(outputPath);
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : String(e));
    }
  }

  const isDone = phase.kind === 'done';
  const isRunning = phase.kind === 'running';
  const isConfig = phase.kind === 'config';
  const isError = phase.kind === 'error';
  
  const dashoffset = PERIMETER * (1 - prog);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <PressableScale hitSlop={12} onPress={onCancel} style={styles.backButton}>
          <ChevronLeft size={22} color="#FFFFFF" strokeWidth={2.5} />
        </PressableScale>
        <Text style={styles.headerTitle}>
          {isRunning ? 'Exporting Master' : isDone ? 'Export Complete' : 'Export Setup'}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.mainContent}>
        {/* Preview Card Section */}
        <View style={styles.previewCard}>
          <View style={styles.thumbnailShadow}>
            <View style={styles.thumbnailContainer}>
              {thumb ? (
                <Image source={{ uri: thumb }} style={styles.thumbnail} resizeMode="cover" />
              ) : (
                <View style={styles.thumbnailPlaceholder}>
                  <Film size={36} color="#4A4A4F" strokeWidth={1.5} />
                </View>
              )}
              
              {!isConfig && (
                <>
                  <View style={styles.thumbnailOverlay} />
                  <Svg width={THUMB_W} height={THUMB_H} style={StyleSheet.absoluteFill}>
                    <SvgGradient id="brandGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <Stop offset="0%" stopColor={isDone ? '#00B09B' : '#9B51E0'} />
                      <Stop offset="100%" stopColor={isDone ? '#96C93D' : '#00C6FF'} />
                    </SvgGradient>
                    <Rect
                      x={STROKE / 2}
                      y={STROKE / 2}
                      width={RECT_W}
                      height={RECT_H}
                      rx={CORNER_R}
                      fill="none"
                      stroke="url(#brandGrad)"
                      strokeWidth={STROKE}
                      strokeLinecap="round"
                      strokeDasharray={PERIMETER}
                      strokeDashoffset={dashoffset}
                    />
                  </Svg>
                  <View style={styles.progressOverlay}>
                    {isDone ? (
                      <LinearGradient colors={DONE_GRADIENT} style={styles.doneBadge}>
                        <Check size={22} color="#FFFFFF" strokeWidth={3} />
                      </LinearGradient>
                    ) : (
                      <View style={styles.progressBadge}>
                        <Text style={styles.progressPercent}>{Math.round(prog * 100)}%</Text>
                      </View>
                    )}
                  </View>
                </>
              )}
            </View>
          </View>

          {/* Core Dynamic Status Block */}
          <View style={styles.statusSection}>
            {isConfig && (
              <Text style={styles.statusDesc}>Choose your export quality</Text>
            )}
            {isRunning && (
              <View style={styles.statusRow}>
                <ActivityIndicator size="small" color="#00C6FF" />
                <Text style={styles.statusText}>{phase.label}</Text>
              </View>
            )}
            {isDone && (
              <View style={styles.statusRow}>
                <Check size={16} color="#00C6FF" strokeWidth={3} />
                <Text style={[styles.statusText, { color: '#00C6FF', fontWeight: '600' }]}>Successfully saved to gallery</Text>
              </View>
            )}
          </View>
        </View>

        {/* Resolution Options Grid */}
        {isConfig && (
          <View style={styles.resSection}>
            <PressableScale
              style={[styles.resCard, resolution === '720p' && styles.resCardActive]}
              onPress={() => setResolution('720p')}
            >
              {resolution === '720p' && (
                <LinearGradient colors={['rgba(155,81,224,0.15)', 'rgba(0,198,255,0.02)']} style={StyleSheet.absoluteFill} start={{x:0, y:0}} end={{x:1, y:1}} />
              )}
              <Text style={[styles.resTitle, resolution === '720p' && styles.resTitleActive]}>
                Standard HD (720p)
              </Text>
              <Text style={styles.resDesc}>Faster Export · Saves storage space</Text>
            </PressableScale>
            
            <PressableScale
              style={[styles.resCard, resolution === '1080p' && styles.resCardActive]}
              onPress={() => setResolution('1080p')}
            >
              {resolution === '1080p' && (
                <LinearGradient colors={['rgba(155,81,224,0.15)', 'rgba(0,198,255,0.02)']} style={StyleSheet.absoluteFill} start={{x:0, y:0}} end={{x:1, y:1}} />
              )}
              <Text style={[styles.resTitle, resolution === '1080p' && styles.resTitleActive]}>
                Mastering Quality (1080p)
              </Text>
              <Text style={styles.resDesc}>Best quality · Recommended</Text>
            </PressableScale>
          </View>
        )}
      </View>

      {/* Dynamic Action Footer */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + space.lg }]}>
        {isConfig && (
          <PressableScale style={styles.exportButtonContainer} onPress={startExport}>
            <LinearGradient colors={BRAND_GRADIENT} style={styles.exportGradientBtn} start={{x:0, y:0}} end={{x:1, y:0}}>
              <Download size={20} color="#FFFFFF" strokeWidth={2.5} />
              <Text style={styles.exportButtonText}>Export Video</Text>
            </LinearGradient>
          </PressableScale>
        )}

        {isDone && (
          <View style={styles.doneActions}>
            <Text style={styles.shareLabel}>Instant share to socials</Text>
            <View style={styles.appIconsRow}>
              <PressableScale style={styles.appIconBtn} onPress={() => handleShare(phase.outputPath)}>
                <Image source={require('../assets/tiktok_icon.png')} style={styles.appIcon} />
                <Text style={styles.appName}>TikTok</Text>
              </PressableScale>
              <PressableScale style={styles.appIconBtn} onPress={() => handleShare(phase.outputPath)}>
                <Image source={require('../assets/capcut_icon.png')} style={styles.appIcon} />
                <Text style={styles.appName}>CapCut</Text>
              </PressableScale>
              <PressableScale style={styles.appIconBtn} onPress={() => handleShare(phase.outputPath)}>
                <Image source={require('../assets/edits_icon.png')} style={styles.appIcon} />
                <Text style={styles.appName}>Edits</Text>
              </PressableScale>
            </View>

            <PressableScale style={styles.doneButton} onPress={onDone}>
              <Text style={styles.doneButtonText}>Finish Project</Text>
            </PressableScale>

            {saveMsg && <Text style={styles.errorMsg}>{saveMsg}</Text>}
          </View>
        )}

        {isError && (
          <View style={styles.errorBlock}>
            <View style={styles.errorCard}>
              <Text style={styles.errorTitle}>Export Engine Halted</Text>
              <Text style={styles.errorDesc}>{phase.message}</Text>
            </View>
            <PressableScale style={styles.retryButton} onPress={onCancel}>
              <Text style={styles.retryButtonText}>Return to Timeline</Text>
            </PressableScale>
          </View>
        )}

        {isRunning && (
          <Text style={styles.keepOpen}>Please don't close the app, video is exporting</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090B', // Premium deep layout backdrop
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
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
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  headerSpacer: {
    width: 44,
  },
  mainContent: {
    flex: 1,
    paddingHorizontal: space.xl,
    justifyContent: 'center',
  },
  previewCard: {
    backgroundColor: '#141417',
    borderRadius: 32,
    padding: 24,
    marginBottom: 32,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  thumbnailShadow: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.6,
    shadowRadius: 24,
    elevation: 12,
    borderRadius: CORNER_R,
  },
  thumbnailContainer: {
    width: THUMB_W,
    height: THUMB_H,
    borderRadius: CORNER_R,
    overflow: 'hidden',
    alignSelf: 'center',
    backgroundColor: '#000000',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  thumbnailPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1C1C21',
  },
  thumbnailOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  progressOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressBadge: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: 'rgba(20, 20, 23, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressPercent: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  doneBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#00B09B',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
  statusSection: {
    marginTop: 20,
    alignItems: 'center',
  },
  statusDesc: {
    fontSize: 13,
    color: '#71717A',
    textAlign: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statusText: {
    fontSize: 14,
    color: '#E4E4E7',
    fontWeight: '500',
  },
  resSection: {
    gap: 14,
  },
  resCard: {
    backgroundColor: '#141417',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  resCardActive: {
    borderColor: '#00C6FF', // Anchored on corporate cyan brand mark
  },
  resTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#A1A1AA',
    marginBottom: 4,
  },
  resTitleActive: {
    color: '#FFFFFF',
  },
  resDesc: {
    fontSize: 13,
    color: '#52525B',
  },
  footer: {
    paddingHorizontal: space.xl,
  },
  exportButtonContainer: {
    borderRadius: 30,
    overflow: 'hidden',
    shadowColor: '#9B51E0',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  exportGradientBtn: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  exportButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  doneActions: {
    gap: 20,
  },
  shareLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#52525B',
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  appIconsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 36,
  },
  appIconBtn: {
    alignItems: 'center',
    gap: 10,
  },
  appIcon: {
    width: 60,
    height: 60,
    borderRadius: 18,
  },
  appName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#A1A1AA',
  },
  doneButton: {
    backgroundColor: '#141417',
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginTop: 8,
  },
  doneButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  errorBlock: {
    gap: 16,
  },
  errorCard: {
    backgroundColor: 'rgba(239, 68, 68, 0.06)',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.15)',
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#EF4444',
    marginBottom: 4,
  },
  errorDesc: {
    fontSize: 13,
    color: 'rgba(239, 68, 68, 0.8)',
    lineHeight: 18,
  },
  retryButton: {
    backgroundColor: '#141417',
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  errorMsg: {
    fontSize: 13,
    color: '#EF4444',
    textAlign: 'center',
    marginTop: 6,
  },
  keepOpen: {
    fontSize: 12,
    color: '#52525B',
    textAlign: 'center',
    paddingVertical: 4,
    fontWeight: '500',
  },
});