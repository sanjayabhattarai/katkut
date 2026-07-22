// BUG FIX: expo-media-library's default ("Next") API has a real bug on iOS — Asset.create()'s
// internal permission re-check always validates the FULL readWrite access level with scope
// "all" (see node_modules/expo-media-library/ios/next/MediaLibraryNextModule.swift
// checkIfPermissionGranted(), hardcoded to MediaLibraryPermissionRequester, never the write-only
// requester), even though requestPermissionsAsync(true) below correctly requests the narrower
// addOnly level. A user who granted Limited Photo Library access (or never touched the
// full-library permission at all, since this app only ever asks for write-only/addOnly) fails
// that check and export throws "Unable to grant permissions" — despite actually holding valid,
// sufficient addOnly permission. The legacy API's createAssetAsync checks whatever access level
// was actually requested (ios/MediaLibraryModule.swift checkPermissions() uses
// requesterClass(self.writeOnly), not a hardcoded level), so it doesn't have this mismatch.
import { createAssetAsync, requestPermissionsAsync } from 'expo-media-library/legacy';
import * as Sharing from 'expo-sharing';

/** Save the finished reel to the device gallery (Photos/Gallery). Returns the saved asset id. */
export async function saveToGallery(localPath: string): Promise<string> {
  const perm = await requestPermissionsAsync(true); // write-only
  if (!perm.granted) {
    throw new Error('Permission to save to gallery was denied.');
  }
  const uri = localPath.startsWith('file://') ? localPath : `file://${localPath}`;
  const asset = await createAssetAsync(uri);
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
