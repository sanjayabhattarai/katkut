// Re-export the native module. On web, it will be resolved to VideoAnalysisModule.web.ts
// and on native platforms to VideoAnalysisModule.ts
export { default } from './src/VideoAnalysisModule';
export * from './src/VideoAnalysis.types';
