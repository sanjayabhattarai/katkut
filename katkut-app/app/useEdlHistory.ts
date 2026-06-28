import { useCallback, useRef, useState } from 'react';
import { Edl } from '../core';

const HISTORY_CAP = 20;

function pushCapped(stack: Edl[], item: Edl): Edl[] {
  const next = [...stack, item];
  return next.length > HISTORY_CAP ? next.slice(next.length - HISTORY_CAP) : next;
}

/**
 * Undo/redo stack over the EDL JSON (cap ~20, technical doc §4).
 *
 * - commit(next): a discrete edit (mute / delete / reorder) — one history step.
 * - beginDrag()/setTransient()/endDrag(): a continuous edit (trim drag). Transient updates
 *   don't touch history; endDrag records ONE step (the pre-drag state), so a whole drag is
 *   a single undo.
 */
export function useEdlHistory(initial: Edl) {
  const [edl, setEdl] = useState<Edl>(initial);
  const [undoStack, setUndoStack] = useState<Edl[]>([]);
  const [redoStack, setRedoStack] = useState<Edl[]>([]);

  // mirror latest edl for callbacks that need the current value synchronously
  const edlRef = useRef(edl);
  edlRef.current = edl;
  const dragBaseRef = useRef<Edl | null>(null);

  const commit = useCallback((next: Edl) => {
    setUndoStack((s) => pushCapped(s, edlRef.current));
    setRedoStack([]);
    setEdl(next);
  }, []);

  const setTransient = useCallback((next: Edl) => {
    setEdl(next);
  }, []);

  const beginDrag = useCallback(() => {
    dragBaseRef.current = edlRef.current;
  }, []);

  const endDrag = useCallback((final: Edl) => {
    const base = dragBaseRef.current;
    dragBaseRef.current = null;
    if (base) {
      setUndoStack((s) => pushCapped(s, base));
      setRedoStack([]);
    }
    setEdl(final);
  }, []);

  const undo = useCallback(() => {
    setUndoStack((s) => {
      if (s.length === 0) return s;
      const prev = s[s.length - 1];
      setRedoStack((r) => pushCapped(r, edlRef.current));
      setEdl(prev);
      return s.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setRedoStack((r) => {
      if (r.length === 0) return r;
      const next = r[r.length - 1];
      setUndoStack((s) => pushCapped(s, edlRef.current));
      setEdl(next);
      return r.slice(0, -1);
    });
  }, []);

  return {
    edl,
    commit,
    setTransient,
    beginDrag,
    endDrag,
    undo,
    redo,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
  };
}
