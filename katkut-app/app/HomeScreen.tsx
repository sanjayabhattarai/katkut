import { useCallback, useEffect, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { listDrafts, listExports, Project } from '../services';

export interface HomeScreenProps {
  onNewProject: () => void;
  onOpenDraft: (project: Project) => void;
  onOpenExport: (project: Project) => void;
}

function fmtDur(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function Tile({ project, onPress }: { project: Project; onPress: () => void }) {
  return (
    <Pressable style={styles.tile} onPress={onPress}>
      {project.thumbUri ? (
        <Image source={{ uri: project.thumbUri }} style={styles.tileThumb} />
      ) : (
        <View style={[styles.tileThumb, styles.tilePlaceholder]}>
          <Text style={styles.tilePlaceholderText}>🎬</Text>
        </View>
      )}
      <Text style={styles.tileDur}>{fmtDur(project.durationSec)}</Text>
    </Pressable>
  );
}

export default function HomeScreen({ onNewProject, onOpenDraft, onOpenExport }: HomeScreenProps) {
  const [drafts, setDrafts] = useState<Project[]>([]);
  const [exports, setExports] = useState<Project[]>([]);

  const reload = useCallback(async () => {
    const [d, e] = await Promise.all([listDrafts(), listExports()]);
    setDrafts(d);
    setExports(e);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.brand}>KatKut</Text>

      <Pressable style={styles.newBtn} onPress={onNewProject}>
        <Text style={styles.newPlus}>+</Text>
        <Text style={styles.newLabel}>New Project</Text>
      </Pressable>

      <Text style={styles.sectionTitle}>Drafts</Text>
      {drafts.length === 0 ? (
        <Text style={styles.empty}>Unfinished timelines show up here.</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {drafts.map((p) => (
            <Tile key={p.id} project={p} onPress={() => onOpenDraft(p)} />
          ))}
        </ScrollView>
      )}

      <Text style={styles.sectionTitle}>Your Previous Edits</Text>
      {exports.length === 0 ? (
        <Text style={styles.empty}>Exported reels show up here.</Text>
      ) : (
        <View style={styles.grid}>
          {exports.map((p) => (
            <Tile key={p.id} project={p} onPress={() => onOpenExport(p)} />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const TILE_W = 104;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  content: { padding: 18, paddingTop: 56, gap: 14 },
  brand: { color: '#fff', fontSize: 24, fontWeight: '800', marginBottom: 6 },
  newBtn: {
    backgroundColor: '#3478f6',
    borderRadius: 16,
    paddingVertical: 26,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  newPlus: { color: '#fff', fontSize: 34, fontWeight: '300', lineHeight: 36 },
  newLabel: { color: '#fff', fontSize: 16, fontWeight: '700' },
  sectionTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginTop: 12 },
  empty: { color: '#777', fontSize: 13 },
  row: { gap: 10, paddingVertical: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: TILE_W },
  tileThumb: {
    width: TILE_W,
    height: TILE_W * (16 / 9),
    borderRadius: 10,
    backgroundColor: '#1a1a1a',
  },
  tilePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  tilePlaceholderText: { fontSize: 28 },
  tileDur: { color: '#aaa', fontSize: 11, marginTop: 4, fontVariant: ['tabular-nums'] },
});
