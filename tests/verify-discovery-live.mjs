// Explicit live test against generated fixtures only; consumes Copilot usage.
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
const home = await mkdtemp(path.join(tmpdir(), 'assistant-discovery-'));
const pictures = path.join(home, 'Pictures'), documents = path.join(home, 'Documents');
await mkdir(pictures); await mkdir(documents);
for (const [name, label, color] of [['no name 001.png', 'Instagram', '#e52b89'], ['no name 002.png', 'Weather forecast', '#1c8ee1']]) {
  await sharp(Buffer.from(`<svg width="700" height="800"><rect width="100%" height="100%" fill="white"/><rect width="700" height="110" fill="${color}"/><text x="35" y="75" font-size="45" fill="white" font-family="sans-serif">${label}</text><text x="35" y="180" font-size="25" font-family="sans-serif">A generated test screenshot</text><rect x="35" y="220" width="630" height="370" rx="20" fill="${color}"/><text x="35" y="675" font-size="24" font-family="sans-serif">Test fixture, not personal content</text></svg>`)).png().toFile(path.join(pictures, name));
}
await writeFile(path.join(documents, 'untitled report.txt'), 'Second year progress report\nAll modules are equally weighted.\nMathematics: 80\nScience: 90\nEnglish: 70\n');
const instance = await createApp({ home, dataDir: path.join(home, 'chats') });
const server = instance.app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-assistant-token': instance.token }, body: JSON.stringify(body) });
try {
  await post('/api/settings', { access: 'full' });
  const chat = await (await post('/api/chats', { model: 'gpt-6-astra', effort: 'high' })).json();
  const response = await post(`/api/chats/${chat.id}/message`, { prompt: `Find the Instagram screenshot I took recently, and calculate my second-year mean from my report. Search ONLY inside ${JSON.stringify(home)}. Use assistant_find_files, inspect the screenshot contents with assistant_inspect_images, read the report using assistant_read_document, and show the verified matching image and report with assistant_show_files. These are generated test fixtures. Do not use shell tools or other locations.` });
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', result = '', names = new Set(), done;
  const timer = setTimeout(() => { void post(`/api/chats/${chat.id}/stop`, {}); }, 180000);
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const type = event.match(/^event: (.+)$/m)?.[1], raw = event.match(/^data: (.+)$/m)?.[1];
        if (!raw) continue;
        const data = JSON.parse(raw);
        if (type === 'tool' && data.name) { names.add(data.name); console.log('Tool:', data.name); }
        if (type === 'question') { console.log('Unexpected question:', data.question); await post(`/api/chats/${chat.id}/answer`, { id: data.id, answer: data.choices?.includes('Deny') ? 'Deny' : 'Use the provided test folders.', wasFreeform: !data.choices?.includes('Deny') }); }
        if (type === 'message' && data.role === 'assistant') result += data.content;
        if (type === 'error') console.log('ERROR:', data.message);
        if (type === 'done') done = data;
      }
    }
  } finally { clearTimeout(timer); }
  console.log(result);
  assert.equal(done?.stopped, false); assert.equal(done?.failed, false);
  for (const name of ['assistant_find_files', 'assistant_inspect_images', 'assistant_read_document', 'assistant_show_files']) assert.ok(names.has(name), name);
  assert.match(result, /80/); assert.match(result, /Instagram/i);
  console.log('PASS: live image-content discovery and report mean from generated fixtures.');
} finally { await instance.close(); await new Promise(resolve => server.close(resolve)); }
