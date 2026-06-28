import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as ImagePicker from 'expo-image-picker';
import * as VideoThumbnails from 'expo-video-thumbnails';
import SplashScreen from './app/SplashScreen';
import HomeScreen from './app/HomeScreen';
import VibeSheet from './app/VibeSheet';
import ProcessingScreen from './app/ProcessingScreen';
import ResultScreen from './app/ResultScreen';
import EditorScreen from './app/EditorScreen';
import ExportScreen from './app/ExportScreen';
import { PickedClip } from './app/types';
import { AnalysisClip, Edl } from './core';
import { Project, newProjectId, saveDraft } from './services';

type Screen = 'splash' | 'home' | 'vibe' | 'processing' | 'result' | 'editor' | 'export';

function clipIdForIndex(index: number): string {
  return `clip_${String(index + 1).padStart(2, '0')}`;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('splash');
  const [clips, setClips] = useState<PickedClip[]>([]);
  const [analyses, setAnalyses] = useState<AnalysisClip[]>([]);
  const [edl, setEdl] = useState<Edl | null>(null);
  const [vibeId, setVibeId] = useState<string>('auto');
  // clipId → low-res preview-proxy URI (preview only; export uses originals)
  const [proxies, setProxies] = useState<Map<string, string>>(new Map());
  // the project being edited (new or reopened) — used for draft auto-save + library promotion
  const [projectId, setProjectId] = useState<string>('');

  // New Project → open the system picker directly (it requests permission on first use).
  async function startNewProject() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsMultipleSelection: true,
      selectionLimit: 0,
      quality: 1,
    });
    if (result.canceled || result.assets.length === 0) return;

    const picked: PickedClip[] = result.assets.map((a, i) => ({
      clipId: clipIdForIndex(i),
      uri: a.uri,
      fileName: a.fileName ?? null,
      durationMs: a.duration ?? null,
      width: a.width ?? null,
      height: a.height ?? null,
    }));
    setClips(picked);
    setAnalyses([]);
    setEdl(null);
    setScreen('vibe');
  }

  function handleVibe(chosen: string) {
    setVibeId(chosen);
    setScreen('processing');
  }

  function handleAnalysisDone(a: AnalysisClip[], e: Edl, p: Map<string, string>) {
    setAnalyses(a);
    setEdl(e);
    setProxies(p);
    setProjectId(newProjectId());
    setScreen('result');
  }

  function openDraft(project: Project) {
    setAnalyses(project.analyses);
    setEdl(project.edl);
    setVibeId(project.vibeId);
    // proxies aren't persisted (throwaway cache) — preview falls back to originals on reopen
    setProxies(new Map());
    setProjectId(project.id);
    setScreen('editor');
  }

  async function makeThumb(currentEdl: Edl): Promise<string | undefined> {
    const firstUri = analyses.find((a) => a.clipId === currentEdl.timeline[0]?.clipId)?.uri;
    if (!firstUri) return undefined;
    try {
      const t = await VideoThumbnails.getThumbnailAsync(firstUri, { time: 0 });
      return t.uri;
    } catch {
      return undefined;
    }
  }

  // App-abandonment rule: leaving the project before export auto-saves the timeline as a draft.
  async function exitToHome(currentEdl: Edl) {
    setScreen('home');
    try {
      const thumbUri = await makeThumb(currentEdl);
      await saveDraft({ id: projectId, vibeId, edl: currentEdl, analyses, thumbUri });
    } catch {
      // persistence is best-effort; never block returning home
    }
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      {screen === 'splash' && <SplashScreen onDone={() => setScreen('home')} />}

      {screen === 'home' && (
        <HomeScreen
          onNewProject={startNewProject}
          onOpenDraft={openDraft}
          onOpenExport={openDraft}
        />
      )}

      {screen === 'vibe' && (
        <VibeSheet onChoose={handleVibe} onCancel={() => setScreen('home')} />
      )}

      {screen === 'processing' && (
        <ProcessingScreen clips={clips} vibeId={vibeId} onDone={handleAnalysisDone} />
      )}

      {screen === 'result' && edl && (
        <ResultScreen
          analyses={analyses}
          edl={edl}
          proxyByClipId={proxies}
          onEdit={() => setScreen('editor')}
          onExport={() => setScreen('export')}
          onClose={() => exitToHome(edl)}
        />
      )}

      {screen === 'editor' && edl && (
        <EditorScreen
          analyses={analyses}
          initialEdl={edl}
          proxyByClipId={proxies}
          onBack={(e) => {
            setEdl(e);
            setScreen('result');
          }}
          onExport={(e) => {
            setEdl(e);
            setScreen('export');
          }}
        />
      )}

      {screen === 'export' && edl && (
        <ExportScreen
          analyses={analyses}
          edl={edl}
          vibeId={vibeId}
          projectId={projectId}
          onDone={() => setScreen('home')}
          onCancel={() => setScreen('result')}
        />
      )}

      <StatusBar style="light" />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
});
