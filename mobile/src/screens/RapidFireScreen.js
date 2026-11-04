/**
 * Rapid fire capture: one student at a time across every question.
 *
 * The label is entered once, then each question is photographed in order.
 * The camera opens on its own for each question, and Use photo uploads and
 * moves on. Steps: 'label' -> 'shoot' (once per question) -> 'summary'.
 *
 * Each upload is awaited before advancing, so a failure is handled on the
 * question it belongs to rather than discovered later.
 */

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

/** Summary label and color for each per-question outcome. */
const RESULT_TEXT = { uploaded: 'Uploaded', skipped: 'Skipped', failed: 'Failed' };
const RESULT_COLORS = { uploaded: '#15803d', skipped: '#6b7280', failed: '#b91c1c' };

/**
 * @param {object} props
 * @param {import('../api').Settings} props.settings
 * @param {{ title: string }} props.assignment
 * @param {object[]} props.questions The assignment's questions in the order to
 *   photograph them.
 * @param {() => void} props.onBack
 */
export default function RapidFireScreen({ settings, assignment, questions, onBack }) {
  const [step, setStep] = useState('label'); // 'label' | 'shoot' | 'summary'
  const [label, setLabel] = useState(''); // text field contents
  const [student, setStudent] = useState(''); // label locked in for this run
  const [checking, setChecking] = useState(false); // duplicate-label check in progress
  const [warning, setWarning] = useState(null); // duplicate-label warning text
  const [index, setIndex] = useState(0); // position in `questions`
  const [photo, setPhoto] = useState(null); // { uri, width, height } of the cached JPEG
  const [busy, setBusy] = useState(false); // camera open or image processing
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState(null); // { kind, text, openSettings? }
  const [results, setResults] = useState({}); // question id -> { status, text? }

  const question = questions[index];

  // Deletes any photo still in the cache when the screen unmounts. A ref is
  // used because the cleanup runs after the last render's state is gone.
  const photoRef = useRef(null);
  photoRef.current = photo;
  useEffect(() => () => deletePhoto(photoRef.current && photoRef.current.uri), []);

  // Opens the camera once per question. If the user closes it, the Take photo
  // and Skip buttons stay on screen instead of the camera reopening.
  const launchedFor = useRef(-1);
  useEffect(() => {
    if (step === 'shoot' && launchedFor.current !== index) {
      launchedFor.current = index;
      capture();
    }
  }, [step, index]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Validates the label and checks it against existing submissions. Starts
   * the run if the label is new; otherwise shows a warning the user can
   * override with Continue anyway.
   */
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
      // photos is usually a typo or a paper entered twice. Labels are
      // compared ignoring case and surrounding spaces, like the gradebook.
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

  /**
   * Starts a run for one student at the first question.
   *
   * @param {string} name The trimmed student label.
   */
  function begin(name) {
    setStudent(name);
    setResults({});
    setIndex(0);
    launchedFor.current = -1;
    setWarning(null);
    setMessage(null);
    setStep('shoot');
  }

  /** Opens the camera and shows the new photo in the preview. */
  async function capture() {
    setMessage(null);
    setBusy(true);
    try {
      const taken = await takePhoto();
      if (!taken) return; // camera closed without a photo
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

  /** Moves to the next question, or to the summary after the last one. */
  function advance() {
    setMessage(null);
    if (index + 1 >= questions.length) setStep('summary');
    else setIndex(index + 1);
  }

  /**
   * Uploads the photo for the current question and advances on success. On
   * failure, stays on the question with the photo kept for Retry upload.
   */
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

  /** Discards the current photo and opens the camera again. */
  function retake() {
    deletePhoto(photo && photo.uri);
    setPhoto(null);
    capture();
  }

  /** Moves on without uploading, e.g. when the student left the question blank. */
  function skip() {
    deletePhoto(photo && photo.uri);
    setPhoto(null);
    // A failed upload stays "failed" rather than becoming "skipped", so the
    // summary still shows it.
    setResults((r) =>
      r[question.id] && r[question.id].status === 'failed' ? r : { ...r, [question.id]: { status: 'skipped' } },
    );
    advance();
  }

  /** Returns to an empty label field for the next paper. */
  function nextStudent() {
    setLabel('');
    setStudent('');
    setResults({});
    setStep('label');
  }

  const failedHere = question && results[question.id] && results[question.id].status === 'failed';
  // Portrait 3:4 is the fallback when the photo's size is unknown.
  const aspect = photo && photo.width && photo.height ? photo.width / photo.height : 3 / 4;

  // The header Back button is hidden mid-upload so leaving the screen can't
  // delete the photo while it is being sent.
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
                // Defensive default; every question is recorded before the summary.
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
