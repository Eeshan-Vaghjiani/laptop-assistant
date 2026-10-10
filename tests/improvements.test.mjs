import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createPreferences, selectEffort } from '../preferences.mjs';
import { confirmationReason } from '../access-policy.mjs';
import { createFileLibrary, inspectImages, previewFile, readDocument } from '../file-library.mjs';

test('preferences survive restart and effort falls back to a supported level', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'assistant-settings-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await createPreferences(dir);
  assert.equal(store.get().model, 'gpt-6-astra');
  await Promise.all([store.update({ access: 'full' }), store.update({ effort: 'high' })]);
  const reopened = await createPreferences(dir);
  assert.equal(reopened.get().access, 'full');
  assert.equal(reopened.get().effort, 'high');
  assert.throws(() => store.update({ access: 'anything' }));
  assert.equal(selectEffort({ efforts: ['low', 'high'] }, 'max'), 'high');
  assert.equal(selectEffort({ efforts: [] }, 'max'), undefined);
});

test('routine actions proceed while deletion, critical paths and managed actions require confirmation', () => {
  const cwd = 'C:\\Users\\tester\\Documents';
  assert.equal(confirmationReason({ kind: 'read', path: 'C:\\Windows\\a.log' }, cwd), null);
  assert.equal(confirmationReason({ kind: 'write', fileName: 'notes.txt' }, cwd), null);
  assert.equal(confirmationReason({ kind: 'shell', fullCommandText: 'Get-ChildItem -LiteralPath C:\\Users\\tester\\Pictures', commands: [{ readOnly: true }] }, cwd), null);
  for (const request of [
    { kind: 'shell', fullCommandText: 'Remove-Item "C:\\Users\\tester\\Documents\\report.pdf"' },
    { kind: 'shell', fullCommandText: 'python -c "import os; os.unlink(\'report.pdf\')"' },
    { kind: 'write', fileName: 'C:\\Windows\\System32\\drivers\\etc\\hosts' },
    { kind: 'write', fileName: 'notes.txt', resolvedPath: 'C:\\Windows\\linked.txt' },
    { kind: 'write', fileName: 'report.txt', diff: '+++ /dev/null' },
    { kind: 'shell', fullCommandText: 'powershell -EncodedCommand abc' },
    { kind: 'read', managedApprovalRequired: true },
  ]) assert.ok(confirmationReason(request, cwd));
});

test('generic filenames can be found by date, inspected visually, and documents read', async t => {
  const home = await mkdtemp(path.join(tmpdir(), 'assistant-library-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const pictures = path.join(home, 'Pictures'), docs = path.join(home, 'Documents');
  await mkdir(pictures); await mkdir(docs);
  const file = path.join(pictures, 'no name 123.png');
  await sharp({ create: { width: 300, height: 200, channels: 3, background: '#d02c90' } }).png().toFile(file);
  const report = path.join(docs, 'no name.txt');
  await writeFile(report, 'Second year progress report\nMaths: 80\nScience: 90');
  const library = createFileLibrary(home);
  const result = await library.search({ kind: 'image', days: 7 });
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].path, file);
  assert.match(result.files[0].evidence, /not inspected/);
  const sheet = await inspectImages([file]);
  assert.equal(sheet.files[0].number, 1);
  assert.equal((await sharp(Buffer.from(sheet.data, 'base64')).metadata()).format, 'jpeg');
  assert.equal((await previewFile(file)).mimeType, 'image/jpeg');
  const matched = await library.search({ kind: 'document', query: 'progress', content: true });
  assert.equal(matched.files[0].path, report);
  assert.match((await readDocument(report)).text, /Maths: 80/);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(library.search({}, cancelled.signal), /stopped/);
  await assert.rejects(previewFile('relative.png'), /absolute/);
  // Render a genuine PDF page through the preview path.
  const pdfPath = path.join(docs, 'report.pdf');
  const text = 'BT /F1 18 Tf 30 150 Td (Year 2 Maths 80 Science 90) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${text.length} >>\nstream\n${text}\nendstream`];
  let pdf = '%PDF-1.4\n', offsets = [0];
  objects.forEach((obj, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  await writeFile(pdfPath, pdf);
  assert.match((await readDocument(pdfPath)).pages[0].text, /Maths 80/);
  assert.equal((await previewFile(pdfPath)).pageCount, 1);
});
