// Prefills the Connect screen when nothing is saved yet, e.g.
// "http://192.168.1.20:5000". The token is never set here; it is typed into
// the app and kept in SecureStore.
export const DEFAULT_SERVER_URL = '';

// Photos are shrunk so the long edge is at most this many pixels, then saved
// as JPEG at this quality (0-1). Converting to JPEG also handles iPhone HEIC.
export const MAX_IMAGE_EDGE = 2000;
export const JPEG_QUALITY = 0.8;

// How often the recent uploads list refreshes while something is queued or
// processing.
export const POLL_MS = 3000;

// Request timeouts. A slow LAN can need a while for a 1-2 MB photo.
export const PING_TIMEOUT_MS = 5000;
export const REQUEST_TIMEOUT_MS = 10000;
export const UPLOAD_TIMEOUT_MS = 60000;
