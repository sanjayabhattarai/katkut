import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import EdlPlayer, { EdlPlayerHandle } from './EdlPlayer';
import ClipStrip from './ClipStrip';
import { uriMapFromAnalyses } from './resultEdl';
import { useClipThumbnails } from './useClipThumbnails';
import { useEdlHistory } from './useEdlHistory';
import { useReelExport } from './useReelExport';
import {
  AnalysisClip,
  Edl,
  deleteClip,
  reorderClip,
  toggleMute,
  recomputeTargetDuration,
} from '../core';

export interface EditorScreenProps {
  analyses: AnalysisClip[];
  initialEdl: Edl;
  onBack: () => void;
}

export default function EditorScreen({ analyses, initialEdl, onBack }: EditorScreenProps) {
  const { edl, commit, undo, redo, canUndo, canRedo } = useEdlHistory(initialEdl);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);

  const playerRef = useRef<EdlPlayerHandle>(null);
  // after an edit commits, re-seek the preview to the affected clip (runs post-render, EDL current)
  const pendingSeekRef = useRef<{ index: number } | null>(null);

  const exp = useReelExport(analyses);

  const uriByClipId = useMemo(() => uriMapFromAnalyses(analyses), [analyses]);
  const durationByClipId = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of analyses) m.set(a.clipId, a.duration);
    return m;
  }, [analyses]);
  const thumbs = useClipThumbnails(edl.timeline, uriByClipId);

  useEffect(() => {
    setCurrentIndex((i) => Math.min(i, Math.max(0, edl.timeline.length - 1)));
  }, [edl.timeline.length]);

  // flush a pending re-seek once the edited EDL has propagated to the player
  useEffect(() => {
    const p = pendingSeekRef.current;
    if (p) {
      pendingSeekRef.current = null;
      playerRef.current?.seekToIndex(p.index, { play: false });
    }
  }, [edl]);

  function handleSelect(index: number) {
    setCurrentIndex(index);
    playerRef.current?.seekToIndex(index, { play: false });
  }

  function handleToggleMute(index: number) {
    commit(toggleMute(edl, index));
    pendingSeekRef.current = { index };
  }

  function handleDelete(index: number) {
    const next = deleteClip(edl, index);
    commit(next);
    pendingSeekRef.current = { index: Math.min(index, next.timeline.length - 1) };
  }

  function handleTrim(index: number, newIn: number, newOut: number) {
    const timeline = edl.timeline.map((t, i) =>
      i === index ? { ...t, in: newIn, out: newOut } : t,
    );
    commit(recomputeTargetDuration({ ...edl, timeline }));
    pendingSeekRef.current = { index };
  }

  function handleReorder(from: number, to: number) {
    commit(reorderClip(edl, from, to));
    pendingSeekRef.current = { index: to };
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Button title="‹ Back" onPress={onBack} />
        <View style={styles.headerCenter}>
          <Button title="↶" onPress={undo} disabled={!canUndo} />
          <Button title="↷" onPress={redo} disabled={!canRedo} />
        </View>
        <Button
          title="Export"
          onPress={() => exp.exportNow(edl)}
          disabled={exp.state.kind === 'exporting'}
        />
      </View>

      <Pressable style={styles.previewBox} onPress={() => playerRef.current?.togglePlay()}>
        <EdlPlayer
          ref={playerRef}
          edl={edl}
          uriByClipId={uriByClipId}
          fill
          loop
          onActiveIndexChange={setCurrentIndex}
          onPlayingChange={setIsPlaying}
        />
        {!isPlaying && (
          <View style={styles.playOverlay} pointerEvents="none">
            <Text style={styles.playIcon}>▶</Text>
          </View>
        )}
      </Pressable>

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
        />
      </View>

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
  root: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 44,
    paddingHorizontal: 8,
    paddingBottom: 4,
  },
  headerCenter: { flexDirection: 'row', gap: 4 },
  previewBox: {
    width: '60%',
    aspectRatio: 9 / 16,
    alignSelf: 'center',
    marginTop: 12,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#2a2a2a',
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  stripWrap: {
    marginTop: 20,
    marginHorizontal: 12,
  },
  playOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: { fontSize: 56, color: 'rgba(255,255,255,0.85)' },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.8)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 24,
  },
  overlayTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  overlayText: { color: '#eee', textAlign: 'center' },
  overlayRow: { flexDirection: 'row', gap: 16 },
});
