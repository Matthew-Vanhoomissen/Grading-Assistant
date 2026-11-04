/**
 * Single-question capture: photograph a stack of papers for one question,
 * one student after another.
 *
 * Steps: 'idle' (Take photo) -> 'preview' (Retake / Use photo) -> 'label'
 * (type the student label, Submit). A successful upload returns to 'idle' on
 * the same question with the label cleared, ready for the next paper.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { uploadPhoto } from '../api';
import { PermissionError, deletePhoto, takePhoto } from '../photo';
import { Button, Message, Screen, formatPoints, styles } from '../ui';
import { questionTitle } from './QuestionsScreen';
import RecentUploads from './RecentUploads';

/**
 * @param {object} props
 * @param {import('../api').Settings} props.settings
 * @param {{ title: string }} props.assignment
 * @param {{ id: number, title: string, position: number, max_points: number }} props.question
 * @param {() => void} props.onBack
 */
export default function CaptureScreen({ settings, assignment, question, onBack }) {
  const [step, setStep] = useState('idle'); // 'idle' | 'preview' | 'label'
  const [photo, setPhoto] = useState(null); // { uri, width, height } of the cached JPEG
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false); // camera open or image processing
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState(null); // { kind, text, openSettings? }
  const [refreshKey, setRefreshKey] = useState(0); // bumped to reload Recent uploads

  // Deletes any photo still in the cache when the screen unmounts. A ref is
  // used because the cleanup runs after the last render's state is gone.
  const photoRef = useRef(null);
  photoRef.current = photo;
  useEffect(() => () => deletePhoto(photoRef.current && photoRef.current.uri), []);

  /** Opens the camera and moves to the preview step with the new photo. */
  async function capture() {
    setMessage(null);
    setBusy(true);
    try {
      const taken = await takePhoto();
      if (!taken) return; // camera closed without a photo
      deletePhoto(photo && photo.uri);
      setPhoto(taken);
      setStep('preview');
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

  /**
   * Uploads the photo under the typed label. On success, resets for the next
   * paper. On failure, keeps the photo and label so Submit can be retried.
   */
  async function submit() {
    const trimmed = label.trim();
    if (!trimmed) {
      setMessage({ kind: 'error', text: 'Enter a student label first.' });
      return;
    }
    setMessage(null);
    setUploading(true);
    try {
      await uploadPhoto(settings, question.id, photo.uri, trimmed);
      deletePhoto(photo.uri);
      setPhoto(null);
      setLabel('');
      setStep('idle');
      setMessage({ kind: 'success', text: `Uploaded "${trimmed}". Ready for the next photo.` });
      setRefreshKey((k) => k + 1);
    } catch (e) {
      // A timed-out upload may still have reached the server, so point the
      // user at Recent uploads (reloaded below) before they retry.
      const text =
        e.kind === 'timeout'
          ? `${e.message} Check Recent uploads before retrying, it may have gone through.`
          : e.message;
      setMessage({ kind: 'error', text: `Upload failed. ${text}` });
      setRefreshKey((k) => k + 1);
    } finally {
      setUploading(false);
    }
  }

  /** Discards the current photo and opens the camera again. */
  function retake() {
    deletePhoto(photo && photo.uri);
    setPhoto(null);
    setStep('idle');
    capture();
  }

  // Portrait 3:4 is the fallback when the photo's size is unknown.
  const aspect = photo && photo.width && photo.height ? photo.width / photo.height : 3 / 4;

  // The header Back button is hidden mid-upload so leaving the screen can't
  // delete the photo while it is being sent.
  return (
    <Screen title={questionTitle(question)} onBack={uploading ? undefined : onBack}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.hint}>
            {assignment.title} · {formatPoints(question.max_points)} pts
          </Text>

          {message ? <Message kind={message.kind}>{message.text}</Message> : null}
          {message && message.openSettings ? (
            <Button title="Open Settings" variant="secondary" onPress={() => Linking.openSettings()} />
          ) : null}

          {step === 'idle' ? <Button title="Take photo" onPress={capture} loading={busy} /> : null}

          {step !== 'idle' && photo ? (
            <Image
              source={{ uri: photo.uri }}
              style={{
                width: '100%',
                aspectRatio: aspect,
                maxHeight: step === 'preview' ? 520 : 220,
                borderRadius: 8,
                backgroundColor: '#ddd',
              }}
              resizeMode="contain"
            />
          ) : null}

          {step === 'preview' ? (
            <View style={styles.row}>
              <Button title="Retake" variant="secondary" onPress={retake} loading={busy} style={styles.flex1} />
              <Button title="Use photo" onPress={() => setStep('label')} disabled={busy} style={styles.flex1} />
            </View>
          ) : null}

          {step === 'label' ? (
            <>
              <Text style={styles.label}>Student label</Text>
              <TextInput
                style={styles.input}
                value={label}
                onChangeText={setLabel}
                placeholder="e.g. student_07"
                autoFocus
                autoCorrect={false}
                returnKeyType="send"
                onSubmitEditing={submit}
                editable={!uploading}
              />
              <View style={styles.row}>
                <Button
                  title="Retake"
                  variant="secondary"
                  onPress={retake}
                  disabled={uploading}
                  style={styles.flex1}
                />
                <Button title="Submit" onPress={submit} loading={uploading} style={styles.flex1} />
              </View>
            </>
          ) : null}

          <View style={{ height: 8 }} />
          <RecentUploads settings={settings} questionId={question.id} refreshKey={refreshKey} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
