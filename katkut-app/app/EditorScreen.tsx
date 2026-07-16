import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  useSharedValue,
  useAnimatedReaction,
  withTiming,
  Easing,
  runOnJS,
  SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pause, Play, Redo2, Undo2, X, Download } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import EdlPlayer, { EdlPlayerHandle } from './EdlPlayer';
import ClipStrip from './ClipStrip';
import { colors, radius, space, type } from './theme';
import { uriMapFromAnalyses } from './resultEdl';
import { useClipThumbnails } from './useClipThumbnails';
import { renderPhotoClip } from './photoClips';
import { generateProxies } from './proxies';
import { useEdlHistory } from './useEdlHistory';
import { VideoAnalysis } from '../native';
import {
  AnalysisClip,
  Edl,
  deleteClip,
  reorderClip,
  selectTimeline,
  toggleMute,
  recomputeTargetDuration,
} from '../core';

export interface EditorScreenProps {
  analyses: AnalysisClip[];
  initialEdl: Edl;
  // BUG FIX: clips added mid-edit (handleAddMedia) only lived in this screen's local
  // extraAnalyses state — App.tsx's own `analyses` (which ExportScreen/exportReel.ts use to
  // resolve each clipId to a source URI) never learned about them, so exporting after adding a
  // clip threw "No source URI for add_...". Both callbacks now also hand back the merged
  // analyses (allAnalyses) so the caller can fold them into its own state.
  onBack: (currentEdl: Edl, analyses: AnalysisClip[]) => void;
  onExport: (currentEdl: Edl, analyses: AnalysisClip[]) => void;
  proxyByClipId?: Map<string, string>;
}

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/**
 * Timecode display isolated into its own component: it reads the playback shared value and
 * re-renders only ITSELF once per whole second — the editor (and the strip) never re-render
 * from playback progress.
 */
function Timecode({ playbackSv, totalSec }: { playbackSv: SharedValue<number>; totalSec: number }) {
  const [curSec, setCurSec] = useState(0);
  useAnimatedReaction(
    () => Math.floor(Math.max(0, playbackSv.value)),
    (sec, prev) => {
      if (sec !== prev) runOnJS(setCurSec)(sec);
    },
  );
  return (
    <View style={styles.timecodeDisplayFrame}>
      <Text style={styles.timecodeActive}>{fmtTime(curSec)}</Text>
      <Text style={styles.timecodeDivider}>/</Text>
      <Text style={styles.timecodeTotal}>{fmtTime(totalSec)}</Text>
    </View>
  );
}

export default function EditorScreen({ analyses, initialEdl, onBack, onExport, proxyByClipId }: EditorScreenProps) {
  const insets = useSafeAreaInsets();
  const { edl, commit, undo, redo, canUndo, canRedo } = useEdlHistory(initialEdl);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  // total length only — the CURRENT position is never React state (it would re-render the whole
  // editor several times a second during playback); the Timecode component reads playbackSv itself.
  const [totalSec, setTotalSec] = useState(0);
  const [adding, setAdding] = useState(false);

  // Smooth playhead: the native player reports position every 100ms. We drive a shared value that
  // linearly glides to each sample, so the strip scrolls continuously at 60fps on the UI thread.
  const playbackSv = useSharedValue(0);
  const lastCurRef = useRef(0);
  const lastTotalRef = useRef(0);
  const handleProgress = (cur: number, total: number) => {
    const jumped = Math.abs(cur - lastCurRef.current) > 0.35; // seek / loop wrap → snap, don't glide
    lastCurRef.current = cur;
    playbackSv.value = jumped ? cur : withTiming(cur, { duration: 130, easing: Easing.linear });
    if (Math.abs(total - lastTotalRef.current) > 0.01) {
      lastTotalRef.current = total;
      setTotalSec(total); // changes only when the timeline itself changes
    }
  };

  const [extraAnalyses, setExtraAnalyses] = useState<AnalysisClip[]>([]);
  const allAnalyses = useMemo(() => [...analyses, ...extraAnalyses], [analyses, extraAnalyses]);

  // BUG FIX: clips added mid-edit (handleAddMedia) never got a proxy generated — proxyByClipId
  // only ever covers the clips that existed at Processing time, so an added clip always fell back
  // to its full-resolution original in preview. Originals have no blurred-fill baked into their
  // pixels (only the proxy pipeline does that, per ProxyTranscoder on both platforms — the
  // preview player itself has no live compositing capability on either Android or iOS), so a
  // landscape/square added clip previewed with plain letterboxing even though export was always
  // correct. Generated the same way ProcessingScreen generates the initial set (see proxies.ts).
  const [extraProxies, setExtraProxies] = useState<Map<string, string>>(new Map());

  // Freshly rendered photo preview clips (clipId → mp4), regenerated when a photo is trimmed so the
  // preview length matches its new duration. Overrides the proxies handed in from Processing.
  const [photoProxies, setPhotoProxies] = useState<Map<string, string>>(new Map());

  const playerRef = useRef<EdlPlayerHandle>(null);
  const pendingSeekRef = useRef<{ index: number; play: boolean } | null>(null);

  const uriByClipId = useMemo(() => uriMapFromAnalyses(allAnalyses), [allAnalyses]);
  const previewUriByClipId = useMemo(() => {
    const m = uriMapFromAnalyses(allAnalyses);
    if (proxyByClipId) {
      for (const [clipId, uri] of proxyByClipId) m.set(clipId, uri);
    }
    // proxies for clips added mid-edit (handleAddMedia) — see extraProxies above
    for (const [clipId, uri] of extraProxies) m.set(clipId, uri);
    // freshly regenerated photo clips win over the originally-rendered proxies
    for (const [clipId, uri] of photoProxies) m.set(clipId, uri);
    return m;
  }, [allAnalyses, proxyByClipId, extraProxies, photoProxies]);

  const durationByClipId = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of allAnalyses) m.set(a.clipId, a.duration);
    return m;
  }, [allAnalyses]);

  const thumbs = useClipThumbnails(edl.timeline, uriByClipId);

  useEffect(() => {
    setCurrentIndex((i) => Math.min(i, Math.max(0, edl.timeline.length - 1)));
  }, [edl.timeline.length]);

  useEffect(() => {
    const p = pendingSeekRef.current;
    if (p) {
      pendingSeekRef.current = null;
      playerRef.current?.seekToIndex(p.index, { play: p.play });
    }
    // also fire after a regenerated photo proxy swaps in (reloads the playlist) so we land back
    // on the edited clip instead of jumping to the start.
  }, [edl, previewUriByClipId]);

  // Re-render a photo's preview clip at its new committed duration (called once per trim commit).
  async function regenPhotoProxy(item: Edl['timeline'][number], index: number) {
    const src = uriByClipId.get(item.clipId);
    if (!src) return;
    try {
      const uri = await renderPhotoClip(item, src, 720, 1280);
      setPhotoProxies((prev) => new Map(prev).set(item.clipId, uri));
      pendingSeekRef.current = { index, play: false };
    } catch {
      // preview proxy is best-effort; export still renders correctly from the original
    }
  }

  function handleSelect(index: number) {
    setCurrentIndex(index);
    playerRef.current?.seekToIndex(index, { play: false });
    // Cue the playhead at the clip's start right away. Otherwise it waits for a progress tick and,
    // while the seek/pause round-trips through native, a late (or looping) tick can drag the strip
    // to the last clip. Setting it here makes selection land deterministically on the tapped clip.
    let startSec = 0;
    for (let i = 0; i < index && i < edl.timeline.length; i++) {
      startSec += Math.max(0, edl.timeline[i].out - edl.timeline[i].in);
    }
    lastCurRef.current = startSec;
    playbackSv.value = startSec;
  }

  function handleToggleMute(index: number) {
    commit(toggleMute(edl, index));
    pendingSeekRef.current = { index, play: isPlaying };
  }

  function handleDelete(index: number) {
    const next = deleteClip(edl, index);
    commit(next);
    pendingSeekRef.current = { index: Math.min(index, next.timeline.length - 1), play: isPlaying };
  }

  // Trim commits ONCE, on release. During the drag the strip animates entirely on the UI thread
  // (see ClipStrip) — no React state changes, no history churn, no playlist rebuilds until here.
  function handleTrimCommit(index: number, newIn: number, newOut: number) {
    const prevItem = edl.timeline[index];
    const timeline = edl.timeline.map((t, i) =>
      i === index ? { ...t, in: newIn, out: newOut } : t,
    );
    commit(recomputeTargetDuration({ ...edl, timeline })); // one undo step per drag
    pendingSeekRef.current = { index, play: false };

    // Photos bake their duration into a rendered clip, so trimming one needs a fresh preview clip.
    if (prevItem?.kind === 'photo') {
      regenPhotoProxy({ ...prevItem, in: newIn, out: newOut }, index);
    }
  }

  function handleReorder(from: number, to: number) {
    commit(reorderClip(edl, from, to));
    pendingSeekRef.current = { index: to, play: isPlaying };
  }

  async function handleAddMedia() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsMultipleSelection: true,
      selectionLimit: 0,
      quality: 1,
    });
    if (result.canceled || result.assets.length === 0) return;

    setAdding(true);
    try {
      const stamp = Date.now();
      const newAnalyses: AnalysisClip[] = [];
      for (let i = 0; i < result.assets.length; i++) {
        const clipId = `add_${stamp}_${i}`;
        const a = await VideoAnalysis.analyze(result.assets[i].uri, clipId);
        newAnalyses.push(a);
      }
      const sel = selectTimeline(newAnalyses);
      const newItems =
        sel.timeline.length > 0
          ? sel.timeline
          : newAnalyses.map((a) => ({ clipId: a.clipId, in: 0, out: a.duration, muted: false }));

      setExtraAnalyses((prev) => [...prev, ...newAnalyses]);
      const appended = recomputeTargetDuration({
        ...edl,
        timeline: [...edl.timeline, ...newItems],
      });
      commit(appended);
      pendingSeekRef.current = { index: edl.timeline.length, play: false };

      // Same proxy pipeline ProcessingScreen runs for the initial pick — without this, added
      // clips fall back to their full-resolution original in preview, which has no blurred-fill
      // baked in (see extraProxies declaration above).
      try {
        const newProxies = await generateProxies(newAnalyses, { ...edl, timeline: newItems });
        setExtraProxies((prev) => new Map([...prev, ...newProxies]));
      } catch (e) {
        console.warn('Proxy generation for added media failed', e);
      }
    } catch (e) {
      console.warn('Add media failed', e);
    } finally {
      setAdding(false);
    }
  }

  return (
    <View style={styles.root}>
      {/* Top Professional Header Navigation */}
      <View style={[styles.topBar, { paddingTop: insets.top + space.sm }]}>
        <Pressable hitSlop={12} onPress={() => onBack(edl, allAnalyses)} style={styles.closeButton}>
          <X size={20} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.workspaceTitle}>Studio Editor</Text>
        <Pressable style={styles.exportBtn} onPress={() => onExport(edl, allAnalyses)}>
          <Download size={14} color="#0F0F11" strokeWidth={2.5} />
          <Text style={styles.exportText}>Export</Text>
        </Pressable>
      </View>

      {/* Central Portrait Studio Canvas Monitoring Surface */}
      <View style={styles.canvasWrap}>
        <View style={styles.canvasContainer}>
          <EdlPlayer
            ref={playerRef}
            edl={edl}
            uriByClipId={previewUriByClipId}
            fill
            loop
            onActiveIndexChange={setCurrentIndex}
            onPlayingChange={setIsPlaying}
            onProgress={handleProgress}
          />
          <Pressable
            style={styles.canvasTapOverlay}
            onPress={() => playerRef.current?.togglePlay()}
          />
        </View>
      </View>

      {/* Core Studio System Controls Infrastructure */}
      <View style={styles.controlCenter}>
        <Pressable 
          hitSlop={12} 
          onPress={() => playerRef.current?.togglePlay()} 
          style={styles.playbackControllerButton}
        >
          {isPlaying ? (
            <Pause size={20} color="#0F0F11" fill="#0F0F11" />
          ) : (
            <Play size={20} color="#0F0F11" fill="#0F0F11" style={{ marginLeft: 2 }} />
          )}
        </Pressable>

        <Timecode playbackSv={playbackSv} totalSec={totalSec} />

        <View style={styles.historyTrackGroup}>
          <Pressable hitSlop={8} onPress={undo} disabled={!canUndo} style={[styles.historyActionBtn, !canUndo && styles.disabledHistory]}>
            <Undo2 size={18} color={canUndo ? '#E5E5EA' : '#48484A'} />
          </Pressable>
          <Pressable hitSlop={8} onPress={redo} disabled={!canRedo} style={[styles.historyActionBtn, !canRedo && styles.disabledHistory]}>
            <Redo2 size={18} color={canRedo ? '#E5E5EA' : '#48484A'} />
          </Pressable>
        </View>
      </View>

      {/* Dynamic Linear Sequence Timeline Track */}
      <View style={[styles.stripWrap, { paddingBottom: insets.bottom + space.sm }]}>
        <ClipStrip
          timeline={edl.timeline}
          selectedIndex={currentIndex}
          thumbs={thumbs}
          durationByClipId={durationByClipId}
          handlesEnabled={!isPlaying}
          onSelect={handleSelect}
          onToggleMute={handleToggleMute}
          onDelete={handleDelete}
          onTrim={handleTrimCommit}
          onReorder={handleReorder}
          onAddMedia={handleAddMedia}
          playbackSv={playbackSv}
          onScrub={(sec) => playerRef.current?.scrubTo(sec)}
          onScrubStart={() => playerRef.current?.pause()}
        />
      </View>

      {/* High-Performance Analysis Sync Modal Cover */}
      {adding && (
        <View style={styles.processingBlockerCover}>
          <View style={styles.processingDialogCard}>
            <ActivityIndicator size="small" color="#0A84FF" />
            <Text style={styles.processingMessageText}>Running local heuristics passes…</Text>
          </View>
        </View>
      )}
    </View>
  );
}

// ================= SCHEMATIC DESIGN CODES =================
const styles = StyleSheet.create({
  root: { 
    flex: 1, 
    backgroundColor: '#070708' // Pitch black editing suite focus environment
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
    backgroundColor: '#070708',
    borderBottomWidth: 1,
    borderColor: '#121214',
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#161618',
    alignItems: 'center',
    justifyContent: 'center',
  },
  workspaceTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#E5E5EA',
    letterSpacing: 0.2,
  },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0A84FF',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 6,
  },
  exportText: { 
    fontSize: 13,
    fontWeight: '700',
    color: '#0F0F11' 
  },
  canvasWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.md,
    paddingHorizontal: space.xl,
  },
  canvasContainer: {
    height: '100%',
    aspectRatio: 9 / 16,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#000000',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
    elevation: 12,
  },
  canvasTapOverlay: { 
    position: 'absolute', 
    top: 0, 
    left: 0, 
    right: 0, 
    bottom: 0 
  },
  controlCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    backgroundColor: '#121214',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  playbackControllerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  timecodeDisplayFrame: { 
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161618',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
  },
  timecodeActive: { 
    fontSize: 12, 
    fontWeight: '700', 
    color: '#FFFFFF', 
    fontVariant: ['tabular-nums'] 
  },
  timecodeDivider: {
    fontSize: 12,
    color: '#48484A',
    fontWeight: '600',
  },
  timecodeTotal: { 
    fontSize: 12, 
    color: '#8E8E93', 
    fontWeight: '500',
    fontVariant: ['tabular-nums'] 
  },
  historyTrackGroup: { 
    flexDirection: 'row', 
    gap: 6 
  },
  historyActionBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#161618',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledHistory: {
    backgroundColor: '#0F0F11',
    opacity: 0.3,
  },
  stripWrap: { 
    backgroundColor: '#121214'
  },
  processingBlockerCover: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(7, 7, 8, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
  processingDialogCard: {
    backgroundColor: '#161618',
    borderWidth: 1,
    borderColor: '#242426',
    borderRadius: 16,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
  },
  processingMessageText: { 
    fontSize: 13, 
    fontWeight: '600',
    color: '#E5E5EA' 
  },
});