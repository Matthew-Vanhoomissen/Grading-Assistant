// Take a photo with the system camera, shrink it, and re-save it as JPEG.
// Photos only live in the app's cache and are deleted after upload; nothing
// is saved to the camera roll.

import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { JPEG_QUALITY, MAX_IMAGE_EDGE } from './config';

export class PermissionError extends Error {
  constructor(canAskAgain) {
    super(
      canAskAgain
        ? 'Camera permission is needed to photograph submissions.'
        : 'Camera access is turned off for this app. Enable it in your phone Settings.',
    );
    this.canAskAgain = canAskAgain;
  }
}

// Returns { uri, width, height } of a JPEG in the cache, or null if the user
// backed out of the camera.
export async function takePhoto() {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new PermissionError(permission.canAskAgain);

  // quality 1 avoids compressing twice; the JPEG step below does it once.
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
  if (result.canceled || !result.assets || !result.assets.length) return null;

  const asset = result.assets[0];
  try {
    return await toJpeg(asset);
  } finally {
    deletePhoto(asset.uri);
  }
}

async function toJpeg({ uri, width, height }) {
  const context = ImageManipulator.manipulate(uri);
  // width/height can be 0 when the OS doesn't report them; then only convert.
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

export function deletePhoto(uri) {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Cache files are cleared by the OS eventually; not worth surfacing.
  }
}
