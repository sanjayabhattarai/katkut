// Re-export the native module. On web, it will be resolved to VideoAssemblerModule.web.ts
// and on native platforms to VideoAssemblerModule.ts
export { default } from './src/VideoAssemblerModule';
export * from './src/VideoAssembler.types';
