import { registerWebModule, NativeModule } from 'expo';

// VideoAnalysisModule is not available on the web platform.
class VideoAnalysisModule extends NativeModule<{}> {}

export default registerWebModule(VideoAnalysisModule, 'VideoAnalysisModule');
