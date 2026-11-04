/**
 * Camera capture and image preparation.
 *
 * Photos are taken with the system camera, scaled down, and re-saved as JPEG.
 * They exist only in the app's cache and are deleted once uploaded or
 * discarded; nothing is saved to the camera roll.
 */

import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { JPEG_QUALITY, MAX_IMAGE_EDGE } from './config';

/** Thrown by takePhoto() when camera permission is not granted. */
export class PermissionError extends Error {
  /**
   * @param {boolean} canAskAgain False when the user must enable the camera
   *   in the phone's Settings, because the app can no longer prompt.
   */
  constructor(canAskAgain) {
    super(
      canAskAgain
        ? 'Camera permission is needed to photograph submissions.'
        : 'Camera access is turned off for this app. Enable it in your phone Settings.',
    );
    this.canAskAgain = canAskAgain;
  }
}

/**
 * Asks for camera permission if needed, opens the camera, and converts the
 * result to an upload-ready JPEG. The camera's original file is deleted.
 *
 * @returns {Promise<{ uri: string, width: number, height: number } | null>}
 *   The JPEG in the cache, or null if the user closed the camera.
 * @throws {PermissionError} When camera access is denied.
 */
export async function takePhoto() {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new PermissionError(permission.canAskAgain);

  // Full quality here so the image is compressed once, in toJpeg().
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
  if (result.canceled || !result.assets || !result.assets.length) return null;

  const asset = result.assets[0];
  try {
    return await toJpeg(asset);
  } finally {
    deletePhoto(asset.uri);
  }
}

/**
 * Scales an image down to MAX_IMAGE_EDGE on its long side (never up) and
 * saves it as JPEG at JPEG_QUALITY.
 *
 * @param {{ uri: string, width: number, height: number }} asset
 * @returns {Promise<{ uri: string, width: number, height: number }>}
 */
async function toJpeg({ uri, width, height }) {
  const context = ImageManipulator.manipulate(uri);
  // The OS may report 0 x 0; then the image is converted without resizing.
  if (width && height && Math.max(width, height) > MAX_IMAGE_EDGE) {
    context.resize(width >= height ? { width: MAX_IMAGE_EDGE } : { height: MAX_IMAGE_EDGE });
  }
  const image = await context.renderAsync();
  try {
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
    return { uri: saved.uri, width: saved.width, height: saved.height };
  } finally {
    image.release();
    context.release();
  }
}

/**
 * Deletes a cached photo. Safe to call with a missing file or no URI.
 *
 * @param {string | null | undefined} uri
 */
export function deletePhoto(uri) {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Best effort: the OS clears the cache eventually.
  }
}
