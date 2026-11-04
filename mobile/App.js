/**
 * Root component of the capture app.
 *
 * The phone is a capture-only client for the grader: it connects to the
 * Flask server, lets the user pick an assignment and question, and uploads
 * labelled photos. Everything else happens on the desktop.
 *
 * Navigation is plain state rather than a navigation library. The current
 * screen is derived from which selections exist:
 *
 *   connect -> assignments -> questions -> capture   (one question, many students)
 *                                     \-> rapid      (one student, every question)
 */

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

/** Holds the connection and selection state and renders the current screen. */
export default function App() {
  const [savedSettings, setSavedSettings] = useState(null); // loaded from storage; prefills Connect
  const [settings, setSettings] = useState(null); // settings that passed the ping
  const [assignment, setAssignment] = useState(null);
  const [question, setQuestion] = useState(null);
  const [rapidQuestions, setRapidQuestions] = useState(null); // non-null while in rapid fire mode
  const [onConnect, setOnConnect] = useState(true); // true while the Connect screen is shown

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

  /**
   * Steps back one screen.
   *
   * @returns {boolean} False on the Connect screen, so the Android back button
   *   falls through to its default behavior (leaving the app).
   */
  function back() {
    if (screen === 'capture') setQuestion(null);
    else if (screen === 'rapid') setRapidQuestions(null);
    else if (screen === 'questions') setAssignment(null);
    else if (screen === 'assignments') setOnConnect(true);
    else return false;
    return true;
  }

  // Re-subscribed on every render so the handler always sees the current
  // screen.
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
          // Selections belong to one server; drop them if the server changed.
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
