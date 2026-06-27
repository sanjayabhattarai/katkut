import { useState } from 'react';
import {
  Button,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { PickedClip } from './types';

function clipIdForIndex(index: number): string {
  return `clip_${String(index + 1).padStart(2, '0')}`;
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  const s = ms / 1000;
  return `${s.toFixed(1)}s`;
}

export interface PickScreenProps {
  onContinue: (clips: PickedClip[]) => void;
}

export default function PickScreen({ onContinue }: PickScreenProps) {
  const [clips, setClips] = useState<PickedClip[]>([]);

  async function handlePick() {
    // System gallery multi-select. Files stay local — nothing is uploaded.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsMultipleSelection: true,
      selectionLimit: 0,
      quality: 1,
    });
    if (result.canceled) return;

    const picked: PickedClip[] = result.assets.map((a, i) => ({
      clipId: clipIdForIndex(i),
      uri: a.uri,
      fileName: a.fileName ?? null,
      durationMs: a.duration ?? null,
      width: a.width ?? null,
      height: a.height ?? null,
    }));
    setClips(picked);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>KatKut</Text>
      <Text style={styles.subtitle}>Drop in your clips from the day</Text>

      <Button title="Pick videos" onPress={handlePick} />

      {clips.length > 0 && (
        <Text style={styles.count}>{clips.length} clips selected</Text>
      )}

      <FlatList
        style={styles.list}
        data={clips}
        keyExtractor={(c) => c.clipId}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.rowId}>{item.clipId}</Text>
            <Text style={styles.rowName} numberOfLines={1}>
              {item.fileName ?? item.uri.split('/').pop()}
            </Text>
            <Text style={styles.rowDur}>{formatDuration(item.durationMs)}</Text>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>No clips yet. Tap “Pick videos”.</Text>
        }
      />

      <Button
        title={clips.length > 0 ? `Continue with ${clips.length} clips` : 'Continue'}
        onPress={() => onContinue(clips)}
        disabled={clips.length === 0}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 64,
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 8,
  },
  count: {
    fontWeight: '600',
    textAlign: 'center',
  },
  list: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
    gap: 10,
  },
  rowId: {
    width: 64,
    fontVariant: ['tabular-nums'],
    color: '#888',
  },
  rowName: {
    flex: 1,
  },
  rowDur: {
    width: 56,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
    color: '#444',
  },
  empty: {
    textAlign: 'center',
    color: '#999',
    marginTop: 24,
  },
});
