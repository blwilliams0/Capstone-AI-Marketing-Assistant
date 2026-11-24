import { mkdir, open, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { MEDIA_TYPES, type MediaStore } from './store.js';

export const LOCAL_MAX_PIXELS = 16_000_000;

/** Single-frame decode and re-encode fixes orientation and strips metadata. */
export async function normalizePracticePhoto(bytes: Buffer, extension: string): Promise<Buffer | null> {
  try {
    const image = sharp(bytes, { limitInputPixels: LOCAL_MAX_PIXELS, failOn: 'warning' });
    const metadata = await image.metadata();
    const format = extension === 'jpg' ? 'jpeg' : extension;
    if (metadata.format !== format || (metadata.pages ?? 1) > 1 || !metadata.width || !metadata.height) return null;
    return await image.rotate().toFormat(format as 'jpeg' | 'png' | 'webp').toBuffer();
  } catch {
    return null;
  }
}

export function createLocalMediaStore(directory: string): MediaStore {
  function file(key: string) {
    if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(key)) {
      throw new Error('Invalid practice photo key');
    }
    return path.join(directory, key);
  }

  return {
    async createUploadLink() { throw new Error('Direct upload is required for practice photos'); },
    async viewLink() { throw new Error('Authenticated download is required for practice photos'); },
    async storePracticePhoto(key, bytes) {
      const target = file(key);
      await mkdir(path.dirname(target), { mode: 0o700, recursive: true });
      await writeFile(target, bytes, { mode: 0o600, flag: 'wx' });
    },
    async download(key, maxBytes) {
      const handle = await open(file(key), 'r').catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      });
      if (!handle) return null;
      try {
        if ((await handle.stat()).size > maxBytes) return 'too_large';
        return await handle.readFile();
      } finally {
        await handle.close();
      }
    },
    async remove(key) {
      await rm(file(key), { force: true });
    },
  };
}

export function practicePhotoType(key: string) {
  return Object.entries(MEDIA_TYPES).find(([, extension]) => key.endsWith(`.${extension}`))?.[0];
}
