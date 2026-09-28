import path from 'node:path';
import { stat } from 'node:fs/promises';

export async function resolveAttachments(paths) {
  if (!Array.isArray(paths) || paths.length > 100) throw new Error('Attach up to 100 files or folders at a time.');
  const attachments = new Map();
  for (const filePath of paths) {
    if (typeof filePath !== 'string' || filePath.length > 32767 || !path.isAbsolute(filePath)) {
      throw new Error('Attachments must have an absolute file or folder path.');
    }
    const normalized = path.normalize(filePath);
    const info = await stat(normalized).catch(() => null);
    if (!info || (!info.isFile() && !info.isDirectory())) throw new Error(`File or folder is unavailable: ${filePath}`);
    const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    attachments.set(key, { type: info.isDirectory() ? 'directory' : 'file', path: normalized, displayName: path.basename(normalized) || normalized });
  }
  return [...attachments.values()];
}
