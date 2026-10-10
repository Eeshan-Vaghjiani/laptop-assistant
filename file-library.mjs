import { readdir, stat, realpath, readFile, open } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import mammoth from 'mammoth';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';

const images = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff']);
const documents = new Set(['.pdf', '.docx', '.txt', '.md', '.csv', '.json', '.log', '.html', '.rtf']);
const textTypes = new Set(['.txt', '.md', '.csv', '.json', '.log', '.html', '.xml', '.js', '.mjs', '.ts', '.py', '.css', '.yaml', '.yml']);
const skip = new Set(['node_modules', '.git', '.cache', '.copilot', '.ssh', 'appdata', '$recycle.bin', 'windows', 'program files', 'program files (x86)', 'programdata', 'dist', 'releases']);
const xml = value => String(value).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const check = signal => { if (signal?.aborted) throw new Error('Search stopped.'); };

export async function localFile(filePath) {
  if (typeof filePath !== 'string' || filePath.includes('\0') || filePath.length > 32767 || !path.isAbsolute(filePath) || /^[\\/]{2}/.test(filePath)) throw new Error('Choose an absolute local file path.');
  const canonical = await realpath(filePath);
  if (/^[\\/]{2}/.test(canonical)) throw new Error('Network file previews are not supported.');
  const info = await stat(canonical);
  return { canonical, info };
}
export async function fileInfo(filePath) {
  const { canonical, info } = await localFile(filePath);
  const ext = path.extname(canonical).toLowerCase();
  return { path: canonical, displayName: path.basename(canonical), type: info.isDirectory() ? 'directory' : 'file',
    kind: info.isDirectory() ? 'folder' : images.has(ext) ? 'image' : ext === '.pdf' ? 'pdf' : documents.has(ext) ? 'document' : 'file',
    size: info.size, modifiedAt: info.mtime.toISOString(), createdAt: info.birthtime.toISOString() };
}

async function imageBuffer(filePath, width = 1600, height = 1600) {
  const { canonical, info } = await localFile(filePath);
  if (!info.isFile() || !images.has(path.extname(canonical).toLowerCase())) throw new Error('This file is not a supported image.');
  if (info.size > 50 * 1024 * 1024) throw new Error('Image is too large to preview (50 MB limit).');
  return sharp(canonical, { limitInputPixels: 60000000, failOn: 'error' }).rotate().resize(width, height, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
}

export async function readDocument(filePath, { page = 1, maxPages = 15, signal } = {}) {
  const { canonical, info } = await localFile(filePath);
  check(signal);
  if (!info.isFile() || info.size > 30 * 1024 * 1024) throw new Error('Document exceeds the 30 MB reading limit.');
  const ext = path.extname(canonical).toLowerCase();
  if (ext === '.pdf') {
    const task = getDocument({ data: new Uint8Array(await readFile(canonical)), useSystemFonts: true, isEvalSupported: false });
    const pdf = await task.promise;
    try {
      const pages = [];
      for (let n = Math.max(1, page); n <= Math.min(pdf.numPages, page + maxPages - 1); n++) {
        check(signal);
        const content = await (await pdf.getPage(n)).getTextContent();
        pages.push({ page: n, text: content.items.map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('').slice(0, 18000) });
      }
      return { path: canonical, pageCount: pdf.numPages, pages, scanned: pages.every(p => !p.text.trim()), nextPage: page + pages.length <= pdf.numPages ? page + pages.length : null };
    } finally { await task.destroy(); }
  }
  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ path: canonical });
    return { path: canonical, text: result.value.slice(0, 80000), truncated: result.value.length > 80000 };
  }
  if (!textTypes.has(ext)) throw new Error('Use an image preview, or open this format in its associated app. Supported documents: PDF, DOCX, text and CSV.');
  const handle = await open(canonical, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(info.size, 120000));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return { path: canonical, text: buffer.subarray(0, bytesRead).toString('utf8'), truncated: info.size > bytesRead };
  } finally { await handle.close(); }
}

export async function renderPdf(filePath, page = 1) {
  const { canonical, info } = await localFile(filePath);
  if (!info.isFile() || path.extname(canonical).toLowerCase() !== '.pdf' || info.size > 30 * 1024 * 1024) throw new Error('Choose a PDF up to 30 MB.');
  const task = getDocument({ data: new Uint8Array(await readFile(canonical)), useSystemFonts: true, isEvalSupported: false });
  const pdf = await task.promise;
  try {
    if (!Number.isInteger(page) || page < 1 || page > pdf.numPages) throw new Error('PDF page is out of range.');
    const item = await pdf.getPage(page), base = item.getViewport({ scale: 1 });
    const viewport = item.getViewport({ scale: Math.min(2, 1600 / Math.max(base.width, base.height)) });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await item.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return { data: canvas.toBuffer('image/png').toString('base64'), mimeType: 'image/png', page, pageCount: pdf.numPages };
  } finally { await task.destroy(); }
}

export async function previewFile(filePath, page = 1) {
  const meta = await fileInfo(filePath);
  if (meta.kind === 'image') return { ...meta, data: (await imageBuffer(meta.path)).toString('base64'), mimeType: 'image/jpeg' };
  if (meta.kind === 'pdf') return { ...meta, ...await renderPdf(meta.path, page) };
  if (meta.kind === 'folder') return { ...meta, text: (await readdir(meta.path)).slice(0, 150).join('\n') };
  const doc = await readDocument(meta.path);
  return { ...meta, text: doc.text, truncated: doc.truncated };
}

export async function inspectImages(paths, signal) {
  if (!Array.isArray(paths) || !paths.length || paths.length > 12) throw new Error('Inspect 1–12 images at a time.');
  const metadata = [], layers = [], cols = Math.min(3, paths.length), cell = paths.length === 1 ? 1500 : 500, label = 44;
  for (let i = 0; i < paths.length; i++) {
    check(signal);
    const meta = await fileInfo(paths[i]);
    const data = await imageBuffer(meta.path, cell - 16, cell - 16);
    const size = await sharp(data).metadata();
    const left = (i % cols) * cell, top = Math.floor(i / cols) * (cell + label);
    layers.push({ input: data, left: left + Math.floor((cell - size.width) / 2), top: top + Math.floor((cell - size.height) / 2) });
    layers.push({ input: Buffer.from(`<svg width="${cell}" height="${label}"><rect width="100%" height="100%" fill="#e8edf4"/><text x="10" y="28" font-size="18" font-family="sans-serif">${i + 1}. ${xml(meta.displayName.slice(0, 38))}</text></svg>`), left, top: top + cell });
    metadata.push({ ...meta, number: i + 1 });
  }
  const data = await sharp({ create: { width: cols * cell, height: Math.ceil(paths.length / cols) * (cell + label), channels: 3, background: '#f3f5f8' } }).composite(layers).jpeg({ quality: 82 }).toBuffer();
  return { files: metadata, data: data.toString('base64'), mimeType: 'image/jpeg' };
}

export function createFileLibrary(home) {
  const roots = [...new Set(['Desktop', 'Documents', 'Downloads', 'Pictures', 'Screenshots'].map(p => path.join(home, p))
    .concat(['OneDrive', 'OneDrive - Personal'].flatMap(base => ['Pictures', 'Documents', 'Desktop'].map(p => path.join(home, base, p)))) )];
  return {
    roots,
    async search({ query = '', kind = 'all', days = 0, roots: requestedRoots, offset = 0, limit = 30, content = false } = {}, signal) {
      if (typeof query !== 'string' || query.length > 300 || !['all', 'image', 'document'].includes(kind)) throw new Error('Invalid file search.');
      if (!Number.isInteger(offset) || offset < 0 || offset > 500 || !Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isFinite(days) || days < 0 || days > 36500) throw new Error('Invalid search limits.');
      if (requestedRoots !== undefined && (!Array.isArray(requestedRoots) || requestedRoots.length > 8)) throw new Error('Choose up to eight search folders.');
      const queue = [], searchedRoots = [], skipped = [];
      // University/business OneDrive names vary by account. Include discovered
      // sync roots instead of assuming only "OneDrive - Personal" exists.
      const syncRoots = requestedRoots ? [] : (await readdir(home, { withFileTypes: true }).catch(() => []))
        .filter(entry => entry.isDirectory() && /^onedrive(?:\s*-|$)/i.test(entry.name)).map(entry => path.join(home, entry.name));
      for (const folder of requestedRoots || [...new Set([...roots, ...syncRoots])]) {
        check(signal);
        try {
          const { canonical, info } = await localFile(folder);
          if (info.isDirectory()) { queue.push({ folder: canonical, depth: 0 }); searchedRoots.push(canonical); }
        } catch { skipped.push(folder); }
      }
      const seen = new Set(), candidates = [], tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
      const start = Date.now(), after = days ? start - days * 86400000 : 0;
      let scanned = 0, examined = 0, contentReads = 0, limited = false;
      while (queue.length) {
        check(signal);
        if (examined >= 30000 || Date.now() - start > 20000) { limited = true; break; }
        const { folder, depth } = queue.shift();
        const key = process.platform === 'win32' ? folder.toLowerCase() : folder;
        if (seen.has(key)) continue;
        seen.add(key);
        let entries;
        try { entries = await readdir(folder, { withFileTypes: true }); } catch { skipped.push(folder); continue; }
        for (const entry of entries) {
          check(signal);
          if (++examined > 30000 || Date.now() - start > 20000) { limited = true; break; }
          if (entry.isSymbolicLink()) continue;
          const target = path.join(folder, entry.name), ext = path.extname(entry.name).toLowerCase();
          if (entry.isDirectory()) { if (depth < 8 && !skip.has(entry.name.toLowerCase()) && !entry.name.startsWith('.')) queue.push({ folder: target, depth: depth + 1 }); continue; }
          if (!entry.isFile() || (kind === 'image' && !images.has(ext)) || (kind === 'document' && !documents.has(ext))) continue;
          scanned++;
          const info = await stat(target).catch(() => null);
          if (!info || (after && Math.max(info.mtimeMs, info.birthtimeMs) < after)) continue;
          let evidence = 'Recent file; contents not inspected', score = 0;
          if (tokens.length) {
            score = tokens.filter(word => target.toLowerCase().includes(word)).length;
            if (score) evidence = 'Filename or folder-name match; contents not inspected';
            if (!score && content && documents.has(ext) && contentReads < 50) {
              contentReads++;
              try {
                const doc = await readDocument(target, { maxPages: 3, signal });
                const text = (doc.text || doc.pages?.map(p => p.text).join('\n') || '').toLowerCase();
                score = tokens.filter(word => text.includes(word)).length;
                if (score) evidence = 'Document-text match (first pages / bounded excerpt)';
              } catch { /* Unsupported or unavailable content is not a match. */ }
            }
            if (!score) continue;
          }
          candidates.push({ path: target, displayName: entry.name, type: 'file', kind: images.has(ext) ? 'image' : ext === '.pdf' ? 'pdf' : documents.has(ext) ? 'document' : 'file', size: info.size, modifiedAt: info.mtime.toISOString(), createdAt: info.birthtime.toISOString(), evidence, score });
          if (candidates.length > 600) { limited = true; candidates.sort((a, b) => b.score - a.score || b.modifiedAt.localeCompare(a.modifiedAt)).splice(500); }
        }
      }
      candidates.sort((a, b) => b.score - a.score || b.modifiedAt.localeCompare(a.modifiedAt));
      return { files: candidates.slice(offset, offset + limit), scanned, examined, searchedRoots, skipped: skipped.slice(0, 20), limited,
        nextOffset: offset + limit < candidates.length ? offset + limit : null,
        note: `Bounded search, up to 8 nested levels. ${limited ? 'Scan limit reached; narrow the folders or time range.' : 'Search finished in accessible folders.'} ${content ? `Read up to 50 document excerpts (${contentReads} attempted).` : ''} Visual content is not matched by filename search: inspect image batches to confirm.` };
    },
  };
}
