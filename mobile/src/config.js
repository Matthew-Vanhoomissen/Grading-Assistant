/**
 * App-wide settings. The token is deliberately absent: it is typed into the
 * Connect screen and kept in SecureStore, never in source.
 */

/**
 * Prefills the Connect screen when nothing has been saved yet, for example
 * "http://192.168.1.20:5000". Empty means the field starts blank.
 */
export const DEFAULT_SERVER_URL = '';

/**
 * Photos are scaled so their long edge is at most MAX_IMAGE_EDGE pixels, then
 * saved as JPEG at JPEG_QUALITY (0-1). The JPEG step also converts iPhone
 * HEIC photos, which the server does not accept.
 */
export const MAX_IMAGE_EDGE = 2000;
export const JPEG_QUALITY = 0.8;

/** Refresh interval for Recent uploads while any item is queued or processing. */
export const POLL_MS = 3000;

/**
 * Request timeouts in milliseconds. Uploads get the most time because a
 * 1-2 MB photo can be slow on a congested network.
 */
export const PING_TIMEOUT_MS = 5000;
export const REQUEST_TIMEOUT_MS = 10000;
export const UPLOAD_TIMEOUT_MS = 60000;
