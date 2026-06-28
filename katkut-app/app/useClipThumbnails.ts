import { useEffect, useState } from 'react';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { Edl } from '../core';

/** Lazily generate one thumbnail per clip (at its in-point). Cached by clipId. */
export function useClipThumbnails(timeline: Edl['timeline'], uriByClipId: Map<string, string>) {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const t of timeline) {
        if (thumbs[t.clipId]) continue;
        const uri = uriByClipId.get(t.clipId);
        if (!uri) continue;
        try {
          const { uri: thumbUri } = await VideoThumbnails.getThumbnailAsync(uri, {
            time: Math.max(0, t.in) * 1000,
          });
          if (!cancelled) setThumbs((prev) => ({ ...prev, [t.clipId]: thumbUri }));
        } catch {
          // thumbnails are a nice-to-have; ignore failures
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline, uriByClipId]);

  return thumbs;
}
