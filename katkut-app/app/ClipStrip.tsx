import { useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import { Edl } from '../core';

export const PX_PER_SEC = 26;
export const STRIP_HEIGHT = 72;
const MIN_LEN_SEC = 0.5;
const GAP = 4;
const PADDING = 12;
const LONG_PRESS_MS = 300;

export interface ClipStripProps {
  timeline: Edl['timeline'];
  selectedIndex: number;
  thumbs: Record<string, string>;
  durationByClipId: Map<string, number>;
  /** show trim handles + delete on the selected clip (only when paused) */
  handlesEnabled: boolean;
  onSelect: (index: number) => void;
  onToggleMute: (index: number) => void;
  onDelete: (index: number) => void;
  onTrim: (index: number, newIn: number, newOut: number) => void;
  /** committed on drag release (long-press + drag to reorder) */
  onReorder: (from: number, to: number) => void;
}

type TrimDraft = { index: number; in: number; out: number };
type DragState = { from: number; tx: number; target: number };

export default function ClipStrip({
  timeline,
  selectedIndex,
  thumbs,
  durationByClipId,
  handlesEnabled,
  onSelect,
  onToggleMute,
  onDelete,
  onTrim,
  onReorder,
}: ClipStripProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scrollRef = useRef<any>(null);
  const [trimDraft, setTrimDraft] = useState<TrimDraft | null>(null);
  const pendingRef = useRef<TrimDraft | null>(null);
  const [drag, setDragState] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const centersRef = useRef<number[]>([]);

  function applyDraft(d: TrimDraft) {
    pendingRef.current = d;
    setTrimDraft(d);
  }
  function endTrim(index: number) {
    const p = pendingRef.current;
    pendingRef.current = null;
    setTrimDraft(null);
    if (p && p.index === index) onTrim(index, p.in, p.out);
  }
  function setDrag(d: DragState | null) {
    dragRef.current = d;
    setDragState(d);
  }
  function targetForDrag(from: number, tx: number): number {
    const centers = centersRef.current;
    const draggedCenter = (centers[from] ?? 0) + tx;
    let best = from;
    let bestDist = Infinity;
    for (let k = 0; k < centers.length; k++) {
      const d = Math.abs(centers[k] - draggedCenter);
      if (d < bestDist) {
        bestDist = d;
        best = k;
      }
    }
    return best;
  }

  // layout: compute each clip's width + center (content coords) for reorder hit-testing
  const widths: number[] = [];
  const centers: number[] = [];
  let cursor = PADDING;
  timeline.forEach((t, i) => {
    const draft = trimDraft && trimDraft.index === i ? trimDraft : null;
    const inPt = draft ? draft.in : t.in;
    const outPt = draft ? draft.out : t.out;
    const w = Math.max(40, (outPt - inPt) * PX_PER_SEC);
    widths[i] = w;
    centers[i] = cursor + w / 2;
    cursor += w + GAP;
  });
  centersRef.current = centers;

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      style={styles.strip}
      contentContainerStyle={styles.content}
      showsHorizontalScrollIndicator={false}
    >
      {timeline.map((t, i) => {
        const selected = i === selectedIndex;
        const sourceDur = durationByClipId.get(t.clipId) ?? t.out;
        const isDragged = drag?.from === i;
        const isTarget = drag != null && drag.target === i && drag.from !== i;

        const reorderPan = Gesture.Pan()
          .activateAfterLongPress(LONG_PRESS_MS)
          .blocksExternalGesture(scrollRef)
          .onStart(() => setDrag({ from: i, tx: 0, target: i }))
          .onUpdate((e) => setDrag({ from: i, tx: e.translationX, target: targetForDrag(i, e.translationX) }))
          .onEnd(() => {
            const ds = dragRef.current;
            setDrag(null);
            if (ds && ds.from !== ds.target) onReorder(ds.from, ds.target);
          })
          .onFinalize(() => setDrag(null));

        return (
          <GestureDetector key={`${t.clipId}-${i}`} gesture={reorderPan}>
            <Pressable
              onPress={() => onSelect(i)}
              style={[
                styles.block,
                { width: widths[i] },
                selected && styles.blockSelected,
                isTarget && styles.blockTarget,
                isDragged && { transform: [{ translateX: drag.tx }], zIndex: 10, opacity: 0.85 },
              ]}
            >
              {thumbs[t.clipId] ? (
                <Image source={{ uri: thumbs[t.clipId] }} style={styles.thumb} />
              ) : (
                <View style={[styles.thumb, styles.placeholder]} />
              )}

              <Pressable hitSlop={8} onPress={() => onToggleMute(i)} style={styles.muteBtn}>
                <Text style={styles.muteIcon}>{t.muted ? '🔇' : '🔊'}</Text>
              </Pressable>

              {selected && handlesEnabled && (
                <>
                  <Pressable hitSlop={8} onPress={() => onDelete(i)} style={styles.deleteBtn}>
                    <Text style={styles.deleteIcon}>🗑️</Text>
                  </Pressable>

                  <TrimHandle
                    side="left"
                    scrollRef={scrollRef}
                    origIn={t.in}
                    origOut={t.out}
                    onChange={(deltaSec, origIn, origOut) => {
                      const newIn = Math.min(Math.max(origIn + deltaSec, 0), origOut - MIN_LEN_SEC);
                      applyDraft({ index: i, in: newIn, out: origOut });
                    }}
                    onEnd={() => endTrim(i)}
                  />
                  <TrimHandle
                    side="right"
                    scrollRef={scrollRef}
                    origIn={t.in}
                    origOut={t.out}
                    onChange={(deltaSec, origIn, origOut) => {
                      const newOut = Math.min(
                        Math.max(origOut + deltaSec, origIn + MIN_LEN_SEC),
                        sourceDur,
                      );
                      applyDraft({ index: i, in: origIn, out: newOut });
                    }}
                    onEnd={() => endTrim(i)}
                  />
                </>
              )}
            </Pressable>
          </GestureDetector>
        );
      })}
    </ScrollView>
  );
}

interface TrimHandleProps {
  side: 'left' | 'right';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scrollRef: React.RefObject<any>;
  origIn: number;
  origOut: number;
  onChange: (deltaSec: number, origIn: number, origOut: number) => void;
  onEnd: () => void;
}

function TrimHandle({ side, scrollRef, origIn, origOut, onChange, onEnd }: TrimHandleProps) {
  const orig = useRef({ in: origIn, out: origOut });
  const pan = Gesture.Pan()
    .blocksExternalGesture(scrollRef)
    .onBegin(() => {
      orig.current = { in: origIn, out: origOut };
    })
    .onUpdate((e) => {
      onChange(e.translationX / PX_PER_SEC, orig.current.in, orig.current.out);
    })
    .onEnd(onEnd)
    .onFinalize(onEnd);

  return (
    <GestureDetector gesture={pan}>
      <View style={[styles.handle, side === 'left' ? styles.handleLeft : styles.handleRight]}>
        <View style={styles.handleGrip} />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  strip: { maxHeight: STRIP_HEIGHT + 12 },
  content: { paddingHorizontal: PADDING, gap: GAP, alignItems: 'center' },
  block: {
    height: STRIP_HEIGHT,
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: '#000',
  },
  blockSelected: { borderColor: '#3478f6' },
  blockTarget: { borderColor: '#7fb0ff', borderStyle: 'dashed' },
  thumb: { width: '100%', height: '100%' },
  placeholder: { backgroundColor: '#ccc' },
  muteBtn: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 10,
    paddingHorizontal: 3,
  },
  muteIcon: { fontSize: 13 },
  deleteBtn: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 10,
    paddingHorizontal: 3,
  },
  deleteIcon: { fontSize: 13 },
  handle: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 18,
    backgroundColor: 'rgba(52,120,246,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleLeft: { left: 0, borderTopLeftRadius: 4, borderBottomLeftRadius: 4 },
  handleRight: { right: 0, borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  handleGrip: { width: 3, height: 24, borderRadius: 2, backgroundColor: '#fff' },
});
