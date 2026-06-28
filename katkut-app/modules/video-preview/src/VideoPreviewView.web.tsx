import { forwardRef, useImperativeHandle } from 'react';
import { View } from 'react-native';
import type { VideoPreviewHandle, VideoPreviewProps } from './VideoPreviewView';

// VideoPreview is Android-native (Media3/ExoPlayer). On web it's a no-op black box.
const VideoPreviewView = forwardRef<VideoPreviewHandle, VideoPreviewProps>(function VideoPreviewView(
  { style },
  ref,
) {
  useImperativeHandle(ref, () => ({ play: () => {}, pause: () => {}, seekToTime: () => {} }), []);
  return <View style={[{ backgroundColor: '#000' }, style]} />;
});

export default VideoPreviewView;
