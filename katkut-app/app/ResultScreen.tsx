import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import EdlPlayer from './EdlPlayer';
import { uriMapFromAnalyses } from './resultEdl';
import { AnalysisClip, Edl } from '../core';

export interface ResultScreenProps {
  analyses: AnalysisClip[];
  edl: Edl;
  /** clipId → low-res preview proxy (preview only; missing entries fall back to the original) */
  proxyByClipId?: Map<string, string>;
  onExport: () => void;
  onEdit: () => void;
  onClose: () => void;
}

/** Quick-action payoff screen: the rough cut loops in the preview; Export or Edit from here. */
export default function ResultScreen({ analyses, edl, proxyByClipId, onExport, onEdit, onClose }: ResultScreenProps) {
  const uriByClipId = useMemo(() => {
    const m = uriMapFromAnalyses(analyses);
    if (proxyByClipId) for (const [clipId, uri] of proxyByClipId) m.set(clipId, uri);
    return m;
  }, [analyses, proxyByClipId]);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable hitSlop={10} onPress={onClose} style={styles.closeBtn}>
          <Text style={styles.closeIcon}>✕</Text>
        </Pressable>
        <Text style={styles.title}>Your reel is ready</Text>
        <View style={styles.closeBtn} />
      </View>

      <View style={styles.previewWrap}>
        <View style={styles.preview}>
          <EdlPlayer edl={edl} uriByClipId={uriByClipId} fill loop />
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable style={[styles.btn, styles.editBtn]} onPress={onEdit}>
          <Text style={styles.editText}>✏️  Edit</Text>
        </Pressable>
        <Pressable style={[styles.btn, styles.exportBtn]} onPress={onExport}>
          <Text style={styles.exportText}>🚀  Export</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', paddingBottom: 28 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 44,
    paddingHorizontal: 14,
    paddingBottom: 6,
  },
  closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  closeIcon: { color: '#fff', fontSize: 22 },
  title: { color: '#fff', fontSize: 16, fontWeight: '700' },
  previewWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', paddingVertical: 8 },
  preview: {
    height: '100%',
    aspectRatio: 9 / 16,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  actions: { flexDirection: 'row', gap: 14, paddingHorizontal: 18, paddingTop: 6 },
  btn: { flex: 1, borderRadius: 16, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  editBtn: { backgroundColor: '#222' },
  editText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  exportBtn: { backgroundColor: '#3478f6' },
  exportText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
