// Server URL and token are kept in SecureStore (Keychain / Keystore) so they
// survive app restarts. Both are small, well under SecureStore's limits.

import * as SecureStore from 'expo-secure-store';

import { DEFAULT_SERVER_URL } from './config';

const URL_KEY = 'grader.serverUrl';
const TOKEN_KEY = 'grader.apiToken';

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

export async function saveSettings({ serverUrl, token }) {
  await SecureStore.setItemAsync(URL_KEY, serverUrl);
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}
