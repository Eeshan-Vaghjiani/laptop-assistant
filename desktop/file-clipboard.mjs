import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAttachments } from '../attachments.mjs';

const execute = promisify(execFile);
const fileFormats = /format="(?:FileNameW?|Shell IDList Array|CF_HDROP|FileDrop)"/i;
const readFiles = `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.Windows.Forms; $files = @([System.Windows.Forms.Clipboard]::GetFileDropList() | ForEach-Object { [string]$_ }); ConvertTo-Json -InputObject $files -Compress`;

// Only inspect the native file-list clipboard. Text that happens to contain a path
// is ordinary text, and a cut operation is never completed by attaching a reference.
export function createFileClipboard(clipboard) {
  let cachedKey, cached;
  return async () => {
    const entries = await clipboard.read();
    if (process.platform === 'linux') {
      const paths = [];
      for (const item of entries) {
        const type = item.types.find(type => /x-special\/gnome-copied-files|x-special\/mate-copied-files/.test(type))
          || item.types.find(type => type === 'text/uri-list' || /format="text\/uri-list"/.test(type));
        if (!type) continue;
        const text = await (await item.getType(type)).text();
        for (const line of text.split(/\r?\n/)) {
          if (line.startsWith('file:')) {
            try { paths.push(fileURLToPath(line)); } catch { /* Ignore nonlocal or malformed URIs. */ }
          }
        }
      }
      return resolveAttachments(paths);
    }
    if (process.platform !== 'win32') return [];
    if (!entries.some(item => item.types.some(type => fileFormats.test(type)))) {
      cachedKey = undefined; cached = undefined; return [];
    }
    // FileName may describe only the first entry; include the entire URI list so
    // copying a different selection with the same first file refreshes the preview.
    const formats = entries.flatMap(item => item.types.filter(type => fileFormats.test(type) || type === 'text/uri-list').map(type => ({ item, type })));
    const hash = createHash('sha256');
    for (const { item, type } of formats) { hash.update(type); hash.update(Buffer.from(await (await item.getType(type)).arrayBuffer())); }
    const key = hash.digest('hex');
    if (key !== cachedKey) {
      cachedKey = key;
      cached = execute(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-STA', '-Command', readFiles],
        { windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024, encoding: 'utf8' })
        .then(({ stdout }) => resolveAttachments(JSON.parse(stdout.replace(/^\uFEFF/, '').trim() || '[]')));
    }
    try { return await cached; }
    catch (error) { if (cachedKey === key) cachedKey = undefined; throw error; }
  };
}
