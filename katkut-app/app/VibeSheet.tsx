import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { VIBE_CHOICES } from '../core';

export interface VibeSheetProps {
  onChoose: (vibeId: string) => void;
  onCancel: () => void;
}

const EMOJI: Record<string, string> = {
  auto: '✨',
  food_vlog: '🍱',
  travel_vlog: '✈️',
  cooking: '🍳',
};

const SUBTITLE: Record<string, string> = {
  auto: 'Smart default',
  food_vlog: 'Appetizing close-ups',
  travel_vlog: 'Scenic & lively',
  cooking: 'Steady, step-by-step',
};

export default function VibeSheet({ onChoose, onCancel }: VibeSheetProps) {
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(slide, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [slide]);

  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [400, 0] });

  return (
    <View style={styles.root}>
      <Pressable style={styles.scrim} onPress={onCancel} />
      <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
        <View style={styles.grabber} />
        <Text style={styles.title}>What type of video is this?</Text>
        {VIBE_CHOICES.map((v) => (
          <Pressable key={v.id} style={styles.option} onPress={() => onChoose(v.id)}>
            <Text style={styles.optEmoji}>{EMOJI[v.id] ?? '🎞️'}</Text>
            <View style={styles.optText}>
              <Text style={styles.optLabel}>{v.label}</Text>
              <Text style={styles.optSub}>{SUBTITLE[v.id] ?? ''}</Text>
            </View>
            <Text style={styles.optChevron}>›</Text>
          </Pressable>
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end' },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: '#161616',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 34,
    gap: 8,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#444',
    alignSelf: 'center',
    marginBottom: 8,
  },
  title: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 6 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#222',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 14,
  },
  optEmoji: { fontSize: 24 },
  optText: { flex: 1 },
  optLabel: { color: '#fff', fontSize: 16, fontWeight: '600' },
  optSub: { color: '#888', fontSize: 12, marginTop: 2 },
  optChevron: { color: '#666', fontSize: 22 },
});
