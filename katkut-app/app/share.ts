import { Asset, requestPermissionsAsync } from 'expo-media-library';
import * as Sharing from 'expo-sharing';

/** Save the finished reel to the device gallery (Photos/Gallery). Returns the saved asset id. */
export async function saveToGallery(localPath: string): Promise<string> {
  const perm = await requestPermissionsAsync(true); // write-only
  if (!perm.granted) {
    throw new Error('Permission to save to gallery was denied.');
  }
  const uri = localPath.startsWith('file://') ? localPath : `file://${localPath}`;
  const asset = await Asset.create(uri);
  return asset.id;
}

/** Open the OS share sheet (TikTok / Instagram / CapCut handoff). */
export async function shareReel(localPath: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  const uri = localPath.startsWith('file://') ? localPath : `file://${localPath}`;
  await Sharing.shareAsync(uri, { mimeType: 'video/mp4', dialogTitle: 'Share your reel' });
}
