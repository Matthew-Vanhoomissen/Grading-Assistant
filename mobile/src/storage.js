/**
 * Persists the connection settings across app restarts.
 *
 * Both values live in SecureStore (iOS Keychain / Android Keystore) because
 * the token is a secret. They are small, well under SecureStore's size limits.
 */

import * as SecureStore from 'expo-secure-store';

import { DEFAULT_SERVER_URL } from './config';

const URL_KEY = 'grader.serverUrl';
const TOKEN_KEY = 'grader.apiToken';

/**
 * Loads the saved settings. Falls back to defaults if nothing is saved or the
 * store cannot be read.
 *
 * @returns {Promise<import('./api').Settings>}
 */
export async function loadSettings() {
  try {
    const [serverUrl, token] = await Promise.all([
      SecureStore.getItemAsync(URL_KEY),
      SecureStore.getItemAsync(TOKEN_KEY),
    ]);
    return { serverUrl: serverUrl ?? DEFAULT_SERVER_URL, token: token ?? '' };
  } catch {
    return { serverUrl: DEFAULT_SERVER_URL, token: '' };
  }
}

/**
 * Saves the settings, replacing any previous values.
 *
 * @param {import('./api').Settings} settings
 * @returns {Promise<void>}
 */
export async function saveSettings({ serverUrl, token }) {
  await SecureStore.setItemAsync(URL_KEY, serverUrl);
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}
