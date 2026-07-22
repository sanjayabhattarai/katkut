import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as VideoThumbnails from 'expo-video-thumbnails';
import SplashScreen from './app/SplashScreen';
import HomeScreen from './app/HomeScreen';
import SettingsScreen from './app/SettingsScreen';
import VibeSheet from './app/VibeSheet';
import OptionsScreen, { AudioMode, LengthRange } from './app/OptionsScreen';
import ProcessingScreen from './app/ProcessingScreen';
import ResultScreen from './app/ResultScreen';
import EditorScreen from './app/EditorScreen';
import ExportScreen from './app/ExportScreen';
import { PickedClip } from './app/types';
import { AnalysisClip, Edl } from './core';
import { Project, newProjectId, saveDraft } from './services';

type Screen = 'splash' | 'home' | 'settings' | 'vibe' | 'options' | 'processing' | 'result' | 'editor' | 'export';

function clipIdForIndex(index: number): string {
  return `clip_${String(index + 1).padStart(2, '0')}`;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('splash');
  const [clips, setClips] = useState<PickedClip[]>([]);
  const [analyses, setAnalyses] = useState<AnalysisClip[]>([]);
  const [edl, setEdl] = useState<Edl | null>(null);
  const [vibeId, setVibeId] = useState<string>('auto');
  // length + audio chosen on the options screen, fed into selection
  const [lengthRange, setLengthRange] = useState<LengthRange | null>(null);
  const [audioMode, setAudioMode] = useState<AudioMode>('smart');
  // set when there wasn't enough footage to reach the requested length
  const [lengthNotice, setLengthNotice] = useState<{ requested: number; actual: number } | null>(null);
  // clipId → low-res preview-proxy URI (preview only; export uses originals)
  const [proxies, setProxies] = useState<Map<string, string>>(new Map());
  // the project being edited (new or reopened) — used for draft auto-save + library promotion
  const [projectId, setProjectId] = useState<string>('');
  // true from the moment "New Project" is tapped through the picker closing + mapping —
  // covers the otherwise-blank gap before the Vibe sheet appears
  const [pickingClips, setPickingClips] = useState(false);

  // New Project → open the system picker directly (it requests permission on first use).
  async function startNewProject() {
    setPickingClips(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos', 'images'],
        allowsMultipleSelection: true,
        selectionLimit: 0,
        quality: 1,
      });
      if (result.canceled || result.assets.length === 0) return;

      const picked: PickedClip[] = result.assets.map((a, i) => ({
        clipId: clipIdForIndex(i),
        kind: a.type === 'image' ? 'photo' : 'video',
        uri: a.uri,
        fileName: a.fileName ?? null,
        durationMs: a.type === 'image' ? null : a.duration ?? null,
        width: a.width ?? null,
        height: a.height ?? null,
      }));
      setClips(picked);
      setAnalyses([]);
      setEdl(null);
      setScreen('vibe');
    } finally {
      setPickingClips(false);
    }
  }

  function handleVibe(chosen: string) {
    setVibeId(chosen);
    setScreen('options');
  }

  function handleGenerate(length: LengthRange, mode: AudioMode) {
    setLengthRange(length);
    setAudioMode(mode);
    setScreen('processing');
  }

  function handleAnalysisDone(a: AnalysisClip[], e: Edl, p: Map<string, string>) {
    setAnalyses(a);
    setEdl(e);
    setProxies(p);
    // not enough footage to reach the requested minimum length? (5s tolerance to avoid nagging on near-misses)
    setLengthNotice(
      lengthRange && e.targetDuration < lengthRange.min - 5
        ? { requested: lengthRange.max, actual: e.targetDuration }
        : null,
    );
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
    <SafeAreaProvider>
      <GestureHandlerRootView style={styles.root}>
      {screen === 'splash' && <SplashScreen onDone={() => setScreen('home')} />}

      {screen === 'home' && (
        <HomeScreen
          onNewProject={startNewProject}
          onOpenDraft={openDraft}
          onOpenExport={openDraft}
          onSettings={() => setScreen('settings')}
          loading={pickingClips}
        />
      )}

      {screen === 'settings' && (
        <SettingsScreen onBack={() => setScreen('home')} />
      )}

      {screen === 'vibe' && (
        <VibeSheet onChoose={handleVibe} onCancel={() => setScreen('home')} />
      )}

      {screen === 'options' && (
        <OptionsScreen
          vibeId={vibeId}
          onBack={() => setScreen('vibe')}
          onGenerate={handleGenerate}
        />
      )}

      {screen === 'processing' && (
        <ProcessingScreen
          clips={clips}
          vibeId={vibeId}
          lengthRange={lengthRange}
          audioMode={audioMode}
          onDone={handleAnalysisDone}
        />
      )}

      {screen === 'result' && edl && (
        <ResultScreen
          analyses={analyses}
          edl={edl}
          proxyByClipId={proxies}
          notice={lengthNotice}
          onEdit={() => setScreen('editor')}
          onExport={() => setScreen('export')}
          onRegenerate={() => setScreen('vibe')}
          onClose={() => exitToHome(edl)}
        />
      )}

      {screen === 'editor' && edl && (
        <EditorScreen
          analyses={analyses}
          initialEdl={edl}
          proxyByClipId={proxies}
          onBack={(e, a) => {
            setEdl(e);
            setAnalyses(a);
            setScreen('result');
          }}
          onExport={(e, a) => {
            setEdl(e);
            setAnalyses(a);
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
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
});
