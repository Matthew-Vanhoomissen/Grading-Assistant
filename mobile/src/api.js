// Every call to the Flask server goes through request(), which adds the
// X-API-Token header and turns failures into an ApiError with a `kind`, so
// screens can tell "can't reach the server" apart from "wrong token".
//
// The phone only reads assignments/questions/submissions and uploads photos.
// It never creates, edits, deletes, reruns, or grades anything.

import { File } from 'expo-file-system';

import {
  PING_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  UPLOAD_TIMEOUT_MS,
} from './config';

export class ApiError extends Error {
  // kind: 'bad_url' | 'unreachable' | 'timeout' | 'auth' | 'http' | 'bad_response'
  constructor(kind, message, status = null) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

// "192.168.1.20:5000/" -> "http://192.168.1.20:5000". Returns null if the
// result doesn't look like an http(s) URL.
export function normalizeServerUrl(raw) {
  let url = (raw || '').trim().replace(/\/+$/, '');
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  if (!/^https?:\/\/[^\s/]+(:\d+)?$/i.test(url)) return null;
  return url;
}

async function request(settings, path, { method = 'GET', body, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const base = normalizeServerUrl(settings.serverUrl);
  if (!base) {
    throw new ApiError('bad_url', 'Server URL should look like http://10.0.0.7:5000');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      body,
      // No Content-Type here: for FormData, fetch must set it itself so the
      // multipart boundary is included.
      headers: { Accept: 'application/json', 'X-API-Token': settings.token || '' },
      signal: controller.signal,
    });
  } catch (e) {
    if (controller.signal.aborted) {
      throw new ApiError('timeout', `No response from ${base} after ${timeoutMs / 1000}s.`);
    }
    const err = new ApiError(
      'unreachable',
      `Can't reach ${base}. Check that the laptop is on the same Wi-Fi, the server is running in network mode, and the firewall allows port ${portOf(base)}.`,
    );
    err.cause = e && e.message;
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401) {
    throw new ApiError('auth', 'Server rejected the token. Check it matches API_TOKEN in the backend .env.', 401);
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Flask's 404 page is HTML, and so is anything that isn't the grader.
  }

  if (!res.ok) {
    const detail = data && data.error ? data.error : `HTTP ${res.status}`;
    throw new ApiError('http', `Server error: ${detail}`, res.status);
  }
  if (data === null) {
    throw new ApiError('bad_response', "The server's reply wasn't JSON. Is this URL the grader server?", res.status);
  }
  return data;
}

function portOf(base) {
  const match = base.match(/:(\d+)$/);
  if (match) return match[1];
  return base.startsWith('https') ? '443' : '80';
}

export async function ping(settings) {
  const data = await request(settings, '/api/ping', { timeoutMs: PING_TIMEOUT_MS });
  if (!data.ok || data.server !== 'grader') {
    throw new ApiError('bad_response', 'Something answered, but it is not the grader server.');
  }
  return data;
}

export function listAssignments(settings) {
  return request(settings, '/api/assignments');
}

export function getAssignment(settings, assignmentId) {
  return request(settings, `/api/assignments/${assignmentId}`);
}

export function listSubmissions(settings, questionId) {
  return request(settings, `/api/questions/${questionId}/submissions`);
}

// Returns the new submission id.
export async function uploadPhoto(settings, questionId, photoUri, label) {
  const file = describeFile(photoUri);
  if (!file.exists) {
    throw new ApiError('bad_response', `The photo file is missing on the phone (${file.text}). Retake it.`);
  }
  // Expo replaces the global fetch (SDK 52+), and its FormData only accepts
  // strings, Blobs, or objects with bytes(), not React Native's
  // { uri, name, type }. An expo-file-system File qualifies: the part's
  // filename and content type come from file.name ("<uuid>.jpg") and file.type.
  const form = new FormData();
  form.append('files', file.file);
  form.append('labels', label);
  try {
    const data = await request(settings, `/api/questions/${questionId}/submissions`, {
      method: 'POST',
      body: form,
      timeoutMs: UPLOAD_TIMEOUT_MS,
    });
    return data.submission_ids[0];
  } catch (e) {
    if (e.kind !== 'unreachable') throw e;
    // fetch only says "Network request failed", so report what we know.
    // Never logs the token or image contents.
    console.warn(`[upload] ${e.cause || 'unknown error'}; ${file.text}`);
    throw new ApiError(
      'unreachable',
      `The upload failed before the server replied (phone says: "${e.cause || 'unknown error'}"; ${file.text}). If Test connection still works, the network is fine and this is an upload problem.`,
    );
  }
}

function describeFile(uri) {
  const scheme = (uri || '').split(':')[0] || 'none';
  try {
    const f = new File(uri);
    return f.exists
      ? {
          exists: true,
          file: f,
          text: `photo ${f.size == null ? 'size unknown' : `${(f.size / 1024 / 1024).toFixed(1)} MB`}, ${scheme}:// uri`,
        }
      : { exists: false, text: `${scheme}:// uri not found` };
  } catch (err) {
    return { exists: false, text: `${scheme}:// uri unreadable: ${err.message}` };
  }
}
