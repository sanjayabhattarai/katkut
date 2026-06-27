import { registerWebModule, NativeModule } from 'expo';

// VideoAssemblerModule is not available on the web platform.
class VideoAssemblerModule extends NativeModule<{}> {}

export default registerWebModule(VideoAssemblerModule, 'VideoAssemblerModule');
