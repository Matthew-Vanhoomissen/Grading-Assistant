// Capture-only client: connect, pick assignment, pick question, photograph,
// label, submit. Screens are switched with plain state, no navigation library.

import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import AssignmentsScreen from './src/screens/AssignmentsScreen';
import CaptureScreen from './src/screens/CaptureScreen';
import ConnectScreen from './src/screens/ConnectScreen';
import QuestionsScreen from './src/screens/QuestionsScreen';
import RapidFireScreen from './src/screens/RapidFireScreen';
import { loadSettings } from './src/storage';

export default function App() {
  const [savedSettings, setSavedSettings] = useState(null); // what the Connect form starts with
  const [settings, setSettings] = useState(null); // settings that passed the ping
  const [assignment, setAssignment] = useState(null);
  const [question, setQuestion] = useState(null);
  const [rapidQuestions, setRapidQuestions] = useState(null); // set while in rapid fire mode
  const [onConnect, setOnConnect] = useState(true);

  useEffect(() => {
    loadSettings().then(setSavedSettings);
  }, []);

  const screen =
    onConnect || !settings
      ? 'connect'
      : !assignment
        ? 'assignments'
        : rapidQuestions
          ? 'rapid'
          : !question
            ? 'questions'
            : 'capture';

  function back() {
    if (screen === 'capture') setQuestion(null);
    else if (screen === 'rapid') setRapidQuestions(null);
    else if (screen === 'questions') setAssignment(null);
    else if (screen === 'assignments') setOnConnect(true);
    else return false;
    return true;
  }

  // Android hardware back steps back one screen instead of closing the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', back);
    return () => sub.remove();
  });

  let content;
  if (!savedSettings) {
    content = (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  } else if (screen === 'connect') {
    content = (
      <ConnectScreen
        initialSettings={settings || savedSettings}
        onConnected={(s) => {
          if (!settings || s.serverUrl !== settings.serverUrl) {
            setAssignment(null);
            setQuestion(null);
            setRapidQuestions(null);
          }
          setSettings(s);
          setOnConnect(false);
        }}
      />
    );
  } else if (screen === 'assignments') {
    content = (
      <AssignmentsScreen settings={settings} onPick={setAssignment} onSettings={() => setOnConnect(true)} />
    );
  } else if (screen === 'questions') {
    content = (
      <QuestionsScreen
        settings={settings}
        assignment={assignment}
        onPick={setQuestion}
        onRapidFire={setRapidQuestions}
        onBack={() => setAssignment(null)}
      />
    );
  } else if (screen === 'rapid') {
    content = (
      <RapidFireScreen
        settings={settings}
        assignment={assignment}
        questions={rapidQuestions}
        onBack={() => setRapidQuestions(null)}
      />
    );
  } else {
    content = (
      <CaptureScreen
        settings={settings}
        assignment={assignment}
        question={question}
        onBack={() => setQuestion(null)}
      />
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {content}
    </SafeAreaProvider>
  );
}
