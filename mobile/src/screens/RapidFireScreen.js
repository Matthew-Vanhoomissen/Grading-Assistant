import { useEffect, useRef, useState } from 'react';
import {
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { listSubmissions, uploadPhoto } from '../api';
import { PermissionError, deletePhoto, takePhoto } from '../photo';
import { Button, Message, Screen, formatPoints, styles } from '../ui';
import { questionTitle } from './QuestionsScreen';

const RESULT_TEXT = { uploaded: 'Uploaded', skipped: 'Skipped', failed: 'Failed' };
const RESULT_COLORS = { uploaded: '#15803d', skipped: '#6b7280', failed: '#b91c1c' };

// One student at a time: enter the label once, then photograph every question
// in order. The camera opens by itself for each question; "Use photo" uploads
// and moves on. Steps: 'label' -> 'shoot' (per question) -> 'summary'.
export default function RapidFireScreen({ settings, assignment, questions, onBack }) {
  const [step, setStep] = useState('label');
  const [label, setLabel] = useState('');
  const [student, setStudent] = useState(''); // label locked in for this run
  const [checking, setChecking] = useState(false);
  const [warning, setWarning] = useState(null);
  const [index, setIndex] = useState(0);
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false); // camera or image processing
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState(null); // { kind, text, openSettings? }
  const [results, setResults] = useState({}); // question id -> { status, text? }

  const question = questions[index];

  // Delete any photo still in the cache when leaving the screen.
  const photoRef = useRef(null);
  photoRef.current = photo;
  useEffect(() => () => deletePhoto(photoRef.current && photoRef.current.uri), []);

  // Open the camera once per question. Cancelling it leaves the Take photo
  // and Skip buttons on screen rather than reopening it.
  const launchedFor = useRef(-1);
  useEffect(() => {
    if (step === 'shoot' && launchedFor.current !== index) {
      launchedFor.current = index;
      capture();
    }
  }, [step, index]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    const name = label.trim();
    if (!name) {
      setMessage({ kind: 'error', text: 'Enter a student label first.' });
      return;
    }
    Keyboard.dismiss();
    setMessage(null);
    setWarning(null);
    setChecking(true);
    try {
      // One photo per student per question, so a label that already has
      // photos is usually a typo or a paper entered twice.
      const lists = await Promise.all(questions.map((q) => listSubmissions(settings, q.id)));
      const key = name.toLowerCase();
      const taken = questions.filter((q, i) =>
        lists[i].some((s) => (s.student_label || '').trim().toLowerCase() === key),
      );
      if (taken.length) {
        setWarning(`"${name}" already has photos for: ${taken.map(questionTitle).join(', ')}.`);
        return;
      }
      begin(name);
    } catch (e) {
      setWarning(`Couldn't check for existing photos. ${e.message}`);
    } finally {
      setChecking(false);
    }
  }

  function begin(name) {
    setStudent(name);
    setResults({});
    setIndex(0);
    launchedFor.current = -1;
    setWarning(null);
    setMessage(null);
    setStep('shoot');
  }

  async function capture() {
    setMessage(null);
    setBusy(true);
    try {
      const taken = await takePhoto();
      if (!taken) return; // backed out of the camera
      deletePhoto(photoRef.current && photoRef.current.uri);
      setPhoto(taken);
    } catch (e) {
      if (e instanceof PermissionError) {
        setMessage({ kind: 'error', text: e.message, openSettings: !e.canAskAgain });
      } else {
        setMessage({ kind: 'error', text: `Couldn't take the photo: ${e.message}` });
      }
    } finally {
      setBusy(false);
    }
  }

  function advance() {
    setMessage(null);
    if (index + 1 >= questions.length) setStep('summary');
    else setIndex(index + 1);
  }

  async function upload() {
    setMessage(null);
    setUploading(true);
    try {
      await uploadPhoto(settings, question.id, photo.uri, student);
      deletePhoto(photo.uri);
      setPhoto(null);
      setResults((r) => ({ ...r, [question.id]: { status: 'uploaded' } }));
      advance();
    } catch (e) {
      // A timed-out upload may still have reached the server.
      const text =
        e.kind === 'timeout' ? `${e.message} It may have gone through; check the desktop before retrying.` : e.message;
      setResults((r) => ({ ...r, [question.id]: { status: 'failed', text } }));
      setMessage({ kind: 'error', text: `Upload failed. ${text}` });
    } finally {
      setUploading(false);
    }
  }

  function retake() {
    deletePhoto(photo && photo.uri);
    setPhoto(null);
    capture();
  }

  function skip() {
    deletePhoto(photo && photo.uri);
    setPhoto(null);
    // Skipping after a failed upload keeps the failure visible in the summary.
    setResults((r) =>
      r[question.id] && r[question.id].status === 'failed' ? r : { ...r, [question.id]: { status: 'skipped' } },
    );
    advance();
  }

  function nextStudent() {
    setLabel('');
    setStudent('');
    setResults({});
    setStep('label');
  }

  const failedHere = question && results[question.id] && results[question.id].status === 'failed';
  const aspect = photo && photo.width && photo.height ? photo.width / photo.height : 3 / 4;

  return (
    <Screen title={`Rapid fire · ${assignment.title}`} onBack={uploading ? undefined : onBack}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {message ? <Message kind={message.kind}>{message.text}</Message> : null}
          {message && message.openSettings ? (
            <Button title="Open Settings" variant="secondary" onPress={() => Linking.openSettings()} />
          ) : null}

          {step === 'label' ? (
            <>
              <Text style={styles.hint}>
                Enter the student once, then photograph each of the {questions.length}{' '}
                {questions.length === 1 ? 'question' : 'questions'} in order. The camera opens for each one.
              </Text>
              <Text style={styles.label}>Student label</Text>
              <TextInput
                style={styles.input}
                value={label}
                onChangeText={(v) => {
                  setLabel(v);
                  setWarning(null);
                }}
                placeholder="e.g. student_07"
                autoFocus
                autoCorrect={false}
                returnKeyType="go"
                onSubmitEditing={start}
                editable={!checking}
              />
              {warning ? (
                <>
                  <Message kind="error">{warning}</Message>
                  <View style={styles.row}>
                    <Button
                      title="Change label"
                      variant="secondary"
                      onPress={() => setWarning(null)}
                      style={styles.flex1}
                    />
                    <Button title="Continue anyway" onPress={() => begin(label.trim())} style={styles.flex1} />
                  </View>
                </>
              ) : (
                <Button title="Start" onPress={start} loading={checking} />
              )}
            </>
          ) : null}

          {step === 'shoot' && question ? (
            <>
              <View>
                <Text style={styles.listTitle}>{student}</Text>
                <Text style={styles.listSub}>
                  {index + 1} of {questions.length}: {questionTitle(question)} ·{' '}
                  {formatPoints(question.max_points)} pts
                </Text>
              </View>

              {photo ? (
                <>
                  <Image
                    source={{ uri: photo.uri }}
                    style={{ width: '100%', aspectRatio: aspect, maxHeight: 480, borderRadius: 8, backgroundColor: '#ddd' }}
                    resizeMode="contain"
                  />
                  <View style={styles.row}>
                    <Button
                      title="Retake"
                      variant="secondary"
                      onPress={retake}
                      disabled={uploading}
                      loading={busy}
                      style={styles.flex1}
                    />
                    <Button
                      title={failedHere ? 'Retry upload' : 'Use photo'}
                      onPress={upload}
                      loading={uploading}
                      disabled={busy}
                      style={styles.flex1}
                    />
                  </View>
                </>
              ) : (
                <Button title="Take photo" onPress={capture} loading={busy} />
              )}
              <Button title="Skip question" variant="secondary" onPress={skip} disabled={uploading || busy} />
            </>
          ) : null}

          {step === 'summary' ? (
            <>
              <Text style={styles.listTitle}>{student}: done</Text>
              {questions.map((q) => {
                const r = results[q.id] || { status: 'skipped' };
                return (
                  <View key={q.id} style={styles.listItem}>
                    <View style={[styles.row, { alignItems: 'center', justifyContent: 'space-between' }]}>
                      <Text style={[styles.listSub, styles.flex1, { marginTop: 0 }]} numberOfLines={1}>
                        {questionTitle(q)}
                      </Text>
                      <Text style={{ color: RESULT_COLORS[r.status], fontWeight: '600' }}>
                        {RESULT_TEXT[r.status]}
                      </Text>
                    </View>
                    {r.text ? <Text style={{ color: '#b91c1c', marginTop: 6 }}>{r.text}</Text> : null}
                  </View>
                );
              })}
              <Button title="Next student" onPress={nextStudent} />
              <Button title="Done" variant="secondary" onPress={onBack} />
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
