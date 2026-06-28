import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import PickScreen from './app/PickScreen';
import ProcessingScreen from './app/ProcessingScreen';
import EditorScreen from './app/EditorScreen';
import { PickedClip } from './app/types';
import { AnalysisClip, Edl } from './core';

type Screen = 'pick' | 'processing' | 'editor';

export default function App() {
  const [screen, setScreen] = useState<Screen>('pick');
  const [clips, setClips] = useState<PickedClip[]>([]);
  const [analyses, setAnalyses] = useState<AnalysisClip[]>([]);
  const [edl, setEdl] = useState<Edl | null>(null);

  function handleContinue(picked: PickedClip[]) {
    setClips(picked);
    setScreen('processing');
  }

  function handleAnalysisDone(a: AnalysisClip[], e: Edl) {
    setAnalyses(a);
    setEdl(e);
    setScreen('editor');
  }

  function backToPick() {
    setClips([]);
    setAnalyses([]);
    setEdl(null);
    setScreen('pick');
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      {screen === 'pick' && <PickScreen onContinue={handleContinue} />}

      {screen === 'processing' && (
        <ProcessingScreen clips={clips} onDone={handleAnalysisDone} />
      )}

      {screen === 'editor' && edl && (
        <EditorScreen analyses={analyses} initialEdl={edl} onBack={backToPick} />
      )}

      <StatusBar style="auto" />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#fff',
  },
});
