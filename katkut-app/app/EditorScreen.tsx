import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import EdlPlayer, { EdlPlayerHandle } from './EdlPlayer';
import ClipStrip from './ClipStrip';
import { uriMapFromAnalyses } from './resultEdl';
import { useClipThumbnails } from './useClipThumbnails';
import { useEdlHistory } from './useEdlHistory';
import { useReelExport } from './useReelExport';
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
  onBack: () => void;
}

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export default function EditorScreen({ analyses, initialEdl, onBack }: EditorScreenProps) {
  const { edl, commit, undo, redo, canUndo, canRedo } = useEdlHistory(initialEdl);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [progress, setProgress] = useState({ cur: 0, total: 0 });
  const [adding, setAdding] = useState(false);

  // clips appended via "+ Add media" after the initial pick
  const [extraAnalyses, setExtraAnalyses] = useState<AnalysisClip[]>([]);
  const allAnalyses = useMemo(() => [...analyses, ...extraAnalyses], [analyses, extraAnalyses]);

  const playerRef = useRef<EdlPlayerHandle>(null);
  // after an edit commits, re-seek the preview to the affected clip (runs post-render, EDL current)
  const pendingSeekRef = useRef<{ index: number; play: boolean } | null>(null);

  const exp = useReelExport(allAnalyses);

  const uriByClipId = useMemo(() => uriMapFromAnalyses(allAnalyses), [allAnalyses]);
  const durationByClipId = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of allAnalyses) m.set(a.clipId, a.duration);
    return m;
  }, [allAnalyses]);
  const thumbs = useClipThumbnails(edl.timeline, uriByClipId);

  useEffect(() => {
    setCurrentIndex((i) => Math.min(i, Math.max(0, edl.timeline.length - 1)));
  }, [edl.timeline.length]);

  // flush a pending re-seek once the edited EDL has propagated to the player
  useEffect(() => {
    const p = pendingSeekRef.current;
    if (p) {
      pendingSeekRef.current = null;
      playerRef.current?.seekToIndex(p.index, { play: p.play });
    }
  }, [edl]);

  // tapping a clip seeks there and pauses, so its trim handles appear (expand/trim it)
  function handleSelect(index: number) {
    setCurrentIndex(index);
    playerRef.current?.seekToIndex(index, { play: false });
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

  // after trimming/extending, stay on that clip paused so its handles remain for more tweaks
  function handleTrim(index: number, newIn: number, newOut: number) {
    const timeline = edl.timeline.map((t, i) =>
      i === index ? { ...t, in: newIn, out: newOut } : t,
    );
    commit(recomputeTargetDuration({ ...edl, timeline }));
    pendingSeekRef.current = { index, play: false };
  }

  function handleReorder(from: number, to: number) {
    commit(reorderClip(edl, from, to));
    pendingSeekRef.current = { index: to, play: isPlaying };
  }

  // + Add media: pick more clips, analyze them on-device, append to the timeline
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
    } catch (e) {
      console.warn('Add media failed', e);
    } finally {
      setAdding(false);
    }
  }

  return (
    <View style={styles.root}>
      {/* Top bar: close · resolution · Next */}
      <View style={styles.topBar}>
        <Pressable hitSlop={10} onPress={onBack} style={styles.iconBtn}>
          <Text style={styles.closeIcon}>✕</Text>
        </Pressable>
        <View style={styles.topRight}>
          <View style={styles.resChip}>
            <Text style={styles.resText}>1080p</Text>
          </View>
          <Pressable
            style={styles.nextBtn}
            onPress={() => exp.exportNow(edl)}
            disabled={exp.state.kind === 'exporting'}
          >
            <Text style={styles.nextText}>Next ›</Text>
          </Pressable>
        </View>
      </View>

      {/* Central 9:16 canvas */}
      <View style={styles.canvasWrap}>
        <View style={styles.canvas}>
          <EdlPlayer
            ref={playerRef}
            edl={edl}
            uriByClipId={uriByClipId}
            fill
            loop
            onActiveIndexChange={setCurrentIndex}
            onPlayingChange={setIsPlaying}
            onProgress={(cur, total) => setProgress({ cur, total })}
          />
          <Pressable
            style={styles.canvasTap}
            onPress={() => playerRef.current?.togglePlay()}
          />
          <Text style={styles.chevron} pointerEvents="none">⌄</Text>
        </View>
      </View>

      {/* Controls row: play · timestamps · undo/redo */}
      <View style={styles.controls}>
        <Pressable hitSlop={10} onPress={() => playerRef.current?.togglePlay()} style={styles.iconBtn}>
          <Text style={styles.playIcon}>{isPlaying ? '❚❚' : '▶'}</Text>
        </Pressable>

        <View style={styles.timeStack}>
          <Text style={styles.timeCur}>{fmtTime(progress.cur)}</Text>
          <Text style={styles.timeTotal}>{fmtTime(progress.total)}</Text>
        </View>

        <View style={styles.historyBtns}>
          <Pressable hitSlop={10} onPress={undo} disabled={!canUndo} style={styles.iconBtn}>
            <Text style={[styles.histIcon, !canUndo && styles.disabled]}>⤺</Text>
          </Pressable>
          <Pressable hitSlop={10} onPress={redo} disabled={!canRedo} style={styles.iconBtn}>
            <Text style={[styles.histIcon, !canRedo && styles.disabled]}>⤻</Text>
          </Pressable>
        </View>
      </View>

      {/* Bottom clip strip (with ruler + center playhead) */}
      <View style={styles.stripWrap}>
        <ClipStrip
          timeline={edl.timeline}
          selectedIndex={currentIndex}
          thumbs={thumbs}
          durationByClipId={durationByClipId}
          handlesEnabled={!isPlaying}
          onSelect={handleSelect}
          onToggleMute={handleToggleMute}
          onDelete={handleDelete}
          onTrim={handleTrim}
          onReorder={handleReorder}
          onAddMedia={handleAddMedia}
        />
      </View>

      {adding && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.overlayText}>Analyzing new clips…</Text>
        </View>
      )}

      {exp.state.kind === 'exporting' && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.overlayText}>Exporting 1080×1920 MP4…</Text>
        </View>
      )}

      {exp.state.kind === 'done' && (
        <View style={styles.overlay}>
          <Text style={styles.overlayTitle}>Exported ✓</Text>
          <View style={styles.overlayRow}>
            <Button title="Save to gallery" onPress={exp.save} />
            <Button title="Share" onPress={exp.share} />
          </View>
          {exp.saveMsg && <Text style={styles.overlayText}>{exp.saveMsg}</Text>}
          <Button title="Close" onPress={exp.dismiss} />
        </View>
      )}

      {exp.state.kind === 'error' && (
        <View style={styles.overlay}>
          <Text style={styles.overlayTitle}>Export failed</Text>
          <Text style={styles.overlayText}>{exp.state.message}</Text>
          <Button title="Close" onPress={exp.dismiss} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 44,
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  iconBtn: { padding: 6, alignItems: 'center', justifyContent: 'center' },
  closeIcon: { color: '#fff', fontSize: 22, fontWeight: '400' },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  resChip: {
    borderWidth: 1,
    borderColor: '#555',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  resText: { color: '#ddd', fontSize: 12, fontWeight: '600' },
  nextBtn: {
    backgroundColor: '#fff',
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 7,
  },
  nextText: { color: '#000', fontSize: 14, fontWeight: '700' },
  canvasWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    paddingVertical: 6,
  },
  canvas: {
    height: '100%',
    aspectRatio: 9 / 16,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  canvasTap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  chevron: {
    position: 'absolute',
    bottom: 4,
    alignSelf: 'center',
    color: 'rgba(255,255,255,0.7)',
    fontSize: 20,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  playIcon: { color: '#fff', fontSize: 18 },
  timeStack: { alignItems: 'center' },
  timeCur: { color: '#fff', fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  timeTotal: { color: '#777', fontSize: 12, fontVariant: ['tabular-nums'] },
  historyBtns: { flexDirection: 'row', gap: 10 },
  histIcon: { color: '#fff', fontSize: 20 },
  disabled: { color: '#444' },
  stripWrap: { paddingBottom: 28 },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 24,
  },
  overlayTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  overlayText: { color: '#eee', textAlign: 'center' },
  overlayRow: { flexDirection: 'row', gap: 16 },
});
