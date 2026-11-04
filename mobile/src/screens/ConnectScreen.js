/**
 * Connect screen: server URL and token, with a ping test. Continue appears
 * only after a successful test, so later screens always start from settings
 * known to work.
 */

import { useState } from 'react';
import { ScrollView, Text, TextInput } from 'react-native';

import { normalizeServerUrl, ping } from '../api';
import { saveSettings } from '../storage';
import { Button, Message, Screen, styles } from '../ui';

/**
 * @param {object} props
 * @param {import('../api').Settings} props.initialSettings Prefills the form.
 * @param {(settings: import('../api').Settings) => void} props.onConnected
 *   Called with the tested settings when the user taps Continue.
 */
export default function ConnectScreen({ initialSettings, onConnected }) {
  const [serverUrl, setServerUrl] = useState(initialSettings.serverUrl);
  const [token, setToken] = useState(initialSettings.token);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null); // { kind, text }
  const [connected, setConnected] = useState(null); // settings that passed the ping; cleared on edit

  /** Normalizes the URL, saves both fields, and pings the server. */
  async function testConnection() {
    const url = normalizeServerUrl(serverUrl);
    if (!url) {
      setResult({ kind: 'error', text: 'Server URL should look like http://192.168.1.20:5000' });
      return;
    }
    const settings = { serverUrl: url, token: token.trim() };
    setServerUrl(url);
    setTesting(true);
    setResult(null);
    setConnected(null);
    try {
      // Saved before the ping, so a correct URL is kept even when the server
      // happens to be off.
      await saveSettings(settings);
      await ping(settings);
      setConnected(settings);
      setResult({ kind: 'success', text: `Connected to ${url}. Token accepted.` });
    } catch (e) {
      setResult({ kind: 'error', text: e.message });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Screen title="Connect to grader">
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Server URL</Text>
        <TextInput
          style={styles.input}
          value={serverUrl}
          onChangeText={(v) => {
            setServerUrl(v);
            setConnected(null);
          }}
          placeholder="http://192.168.1.20:5000"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Text style={styles.hint}>
          The laptop's IPv4 address from ipconfig, plus :5000. It changes between networks.
        </Text>

        <Text style={styles.label}>Token</Text>
        <TextInput
          style={styles.input}
          value={token}
          onChangeText={(v) => {
            setToken(v);
            setConnected(null);
          }}
          placeholder="API_TOKEN from the backend .env"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />

        <Button title="Test connection" onPress={testConnection} loading={testing} />
        {result ? <Message kind={result.kind}>{result.text}</Message> : null}
        {connected ? <Button title="Continue" onPress={() => onConnected(connected)} /> : null}
      </ScrollView>
    </Screen>
  );
}
