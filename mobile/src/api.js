/**
 * Client for the grader's Flask API.
 *
 * Every call goes through request(), which adds the X-API-Token header and
 * turns every failure into an ApiError with a `kind`, so screens can tell
 * "can't reach the server" apart from "wrong token".
 *
 * The phone is capture-only: it reads assignments, questions, and submission
 * statuses, and uploads photos. It never creates, edits, deletes, reruns, or
 * grades anything.
 */

import { File } from 'expo-file-system';

import {
  PING_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  UPLOAD_TIMEOUT_MS,
} from './config';

/**
 * @typedef {object} Settings
 * @property {string} serverUrl Base URL of the Flask server, e.g. "http://192.168.1.20:5000".
 * @property {string} token Shared secret sent as X-API-Token.
 */

/**
 * A failed API call.
 *
 * `kind` is one of:
 * - 'bad_url': the server URL is malformed; nothing was sent.
 * - 'unreachable': no connection (wrong IP, server down, firewall, different Wi-Fi).
 * - 'timeout': connected, but no response in time.
 * - 'auth': the server rejected the token (401).
 * - 'http': any other non-2xx response; the message carries the server's error.
 * - 'bad_response': the reply was not what the grader sends.
 */
export class ApiError extends Error {
  /**
   * @param {string} kind See the class description.
   * @param {string} message User-facing explanation.
   * @param {number | null} [status] HTTP status, when a response was received.
   */
  constructor(kind, message, status = null) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

/**
 * Cleans up a typed server URL: trims it, drops trailing slashes, and adds
 * "http://" when no scheme is given, so "192.168.1.20:5000/" becomes
 * "http://192.168.1.20:5000".
 *
 * @param {string} raw
 * @returns {string | null} The normalized URL, or null if it is not a bare
 *   http(s) host with an optional port.
 */
export function normalizeServerUrl(raw) {
  let url = (raw || '').trim().replace(/\/+$/, '');
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  if (!/^https?:\/\/[^\s/]+(:\d+)?$/i.test(url)) return null;
  return url;
}

/**
 * Sends one request to the server and returns its parsed JSON body.
 *
 * @param {Settings} settings
 * @param {string} path Path starting with "/api/".
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {FormData} [options.body]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<any>}
 * @throws {ApiError}
 */
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
      // Content-Type is left to fetch so a multipart body gets its boundary.
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
    // Kept for diagnostics; uploadPhoto() surfaces it.
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
    // Not JSON: Flask's 404 page is HTML, as is anything that isn't the grader.
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

/**
 * Returns the port a URL connects to, for the firewall hint.
 *
 * @param {string} base A normalized server URL.
 * @returns {string}
 */
function portOf(base) {
  const match = base.match(/:(\d+)$/);
  if (match) return match[1];
  return base.startsWith('https') ? '443' : '80';
}

/**
 * Checks the connection and the token in one call (GET /api/ping).
 *
 * @param {Settings} settings
 * @returns {Promise<{ ok: true, server: 'grader' }>}
 * @throws {ApiError} 'auth' for a bad token, 'unreachable'/'timeout' for
 *   network problems, 'bad_response' if something other than the grader replied.
 */
export async function ping(settings) {
  const data = await request(settings, '/api/ping', { timeoutMs: PING_TIMEOUT_MS });
  if (!data.ok || data.server !== 'grader') {
    throw new ApiError('bad_response', 'Something answered, but it is not the grader server.');
  }
  return data;
}

/**
 * Lists all assignments (GET /api/assignments).
 *
 * @param {Settings} settings
 * @returns {Promise<Array<{ id: number, title: string, question_count: number, total_points: number }>>}
 */
export function listAssignments(settings) {
  return request(settings, '/api/assignments');
}

/**
 * Fetches one assignment with its questions (GET /api/assignments/:id).
 *
 * @param {Settings} settings
 * @param {number} assignmentId
 * @returns {Promise<{ id: number, title: string, questions: object[] }>}
 */
export function getAssignment(settings, assignmentId) {
  return request(settings, `/api/assignments/${assignmentId}`);
}

/**
 * Lists a question's submissions with their status
 * (GET /api/questions/:id/submissions).
 *
 * @param {Settings} settings
 * @param {number} questionId
 * @returns {Promise<Array<{ id: number, student_label: string, status: string, error_message: string | null }>>}
 */
export function listSubmissions(settings, questionId) {
  return request(settings, `/api/questions/${questionId}/submissions`);
}

/**
 * Uploads one photo as a new submission for a question
 * (POST /api/questions/:id/submissions).
 *
 * @param {Settings} settings
 * @param {number} questionId
 * @param {string} photoUri file:// URI of a JPEG in the app's cache.
 * @param {string} label Student label stored with the submission.
 * @returns {Promise<number>} The new submission id.
 * @throws {ApiError} An 'unreachable' error here includes the phone's own
 *   error text and the photo's size, since fetch reports every transport
 *   failure the same way.
 */
export async function uploadPhoto(settings, questionId, photoUri, label) {
  const file = describeFile(photoUri);
  if (!file.exists) {
    throw new ApiError('bad_response', `The photo file is missing on the phone (${file.text}). Retake it.`);
  }
  // Expo replaces the global fetch (SDK 52+), and its FormData accepts only
  // strings, Blobs, or objects with bytes(), not React Native's
  // { uri, name, type }. An expo-file-system File qualifies; the part's
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
    // Logs only the error text and file size, never the token or image data.
    console.warn(`[upload] ${e.cause || 'unknown error'}; ${file.text}`);
    throw new ApiError(
      'unreachable',
      `The upload failed before the server replied (phone says: "${e.cause || 'unknown error'}"; ${file.text}). If Test connection still works, the network is fine and this is an upload problem.`,
    );
  }
}

/**
 * Opens a local file and summarizes it for error messages.
 *
 * @param {string} uri
 * @returns {{ exists: boolean, file?: File, text: string }} `file` is set only
 *   when the file exists; `text` is a short description such as
 *   "photo 0.4 MB, file:// uri".
 */
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
