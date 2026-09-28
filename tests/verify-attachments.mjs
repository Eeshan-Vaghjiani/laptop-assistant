// Native attachment integration without sending a request to Copilot.
import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temp = await mkdtemp(path.join(tmpdir(), 'assistant-attachments-'));
const file = path.join(temp, 'résumé test.txt'), folder = path.join(temp, 'Example folder');
await writeFile(file, 'A real file for drag and drop');
await mkdir(folder);
const env = { ...process.env, ASSISTANT_TEST_PROFILE: path.join(temp, 'profile') };
delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.argv.includes('--packaged');
const desktop = await electron.launch({
  ...(process.env.ASSISTANT_VERIFY_EXE ? { executablePath: process.env.ASSISTANT_VERIFY_EXE } : packaged ? { executablePath: path.join(root, 'dist/Laptop Assistant-win32-x64/Laptop Assistant.exe') } : { args: [root] }),
  env, timeout: 60000,
});
try {
  const page = await desktop.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/status', route => route.fulfill({ json: { authenticated: true, login: 'attachment-test', models: [{ id: 'auto', name: 'Auto' }] } }));
  await page.waitForURL('http://127.0.0.1:*/');
  await page.reload();
  await page.locator('#connection').filter({ hasText: 'Connected to GitHub Copilot' }).waitFor();
  await page.bringToFront();
  await desktop.evaluate(({ clipboard }) => clipboard.writeText('ordinary copied text'));
  await page.locator('#prompt').focus();
  await page.keyboard.press('Control+v');
  await page.waitForFunction(() => document.getElementById('prompt').value === 'ordinary copied text');
  assert.equal(await page.locator('#clipboard-preview').isVisible(), false);
  await desktop.evaluate(({ clipboard }, file) => clipboard.writeText(file), file);
  await page.locator('#prompt').fill('');
  await page.keyboard.press('Control+v');
  await page.waitForFunction(file => document.getElementById('prompt').value === file, file);
  assert.equal(await page.locator('#attachments .attachment-chip').count(), 0);
  await page.locator('#prompt').fill('');
  await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, file);
  await page.locator('#add-files').click();
  await page.locator('#attachments').filter({ hasText: 'résumé test.txt' }).waitFor();
  await desktop.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, folder);
  await page.locator('#add-folder').click();
  await page.locator('#attachments').filter({ hasText: 'Example folder' }).waitFor();
  assert.equal(await page.locator('#attachments .attachment-chip').count(), 2);
  assert.equal(await page.locator('#send').isEnabled(), true);
  await page.locator('#new-chat').click();

  // Use an OS-backed File, rather than a synthetic JS File which has no path.
  await page.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.id = 'test-drop'; document.body.append(input); });
  await page.locator('#test-drop').setInputFiles(file);
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(document.getElementById('test-drop').files[0]);
    document.getElementById('composer').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    document.getElementById('test-drop').remove();
  });
  await page.locator('#attachments').filter({ hasText: 'résumé test.txt' }).waitFor();
  await page.locator('#new-chat').click();

  const cdp = await page.context().newCDPSession(page);
  const bounds = await page.locator('#composer').boundingBox();
  const drag = { x: bounds.x + 40, y: bounds.y + 40, data: { items: [], files: [folder], dragOperationsMask: 1 } };
  await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', ...drag });
  await page.locator('#drop-overlay').waitFor();
  await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', ...drag });
  await cdp.send('Input.dispatchDragEvent', { type: 'drop', ...drag });
  await page.locator('#attachments').filter({ hasText: 'Folder · Example folder' }).waitFor();
  assert.equal(await page.locator('#drop-overlay').isVisible(), false);
  await cdp.detach();
  await page.locator('#new-chat').click();

  const psQuote = text => `'${text.replaceAll("'", "''")}'`;
  await promisify(execFile)('powershell.exe', ['-NoProfile', '-STA', '-Command',
    `Add-Type -AssemblyName System.Windows.Forms; $files = New-Object System.Collections.Specialized.StringCollection; [void]$files.Add(${psQuote(file)}); [void]$files.Add(${psQuote(folder)}); [System.Windows.Forms.Clipboard]::SetFileDropList($files)`], { windowsHide: true });
  console.log('Native file clipboard formats:', await desktop.evaluate(async ({ clipboard }) => (await clipboard.read()).map(item => item.types)));
  await page.bringToFront();
  await page.locator('#clipboard-preview').waitFor({ timeout: 20000 });
  await page.locator('#paste-files').click();
  await page.waitForFunction(() => document.querySelectorAll('#attachments .attachment-chip').length === 2);
  await page.locator('#new-chat').click();
  await page.locator('#prompt').focus();
  await page.keyboard.press('Control+v');
  await page.waitForFunction(() => document.querySelectorAll('#attachments .attachment-chip').length === 2);
  assert.equal(await page.locator('#prompt').inputValue(), '');
  await page.keyboard.press('Control+v');
  assert.equal(await page.locator('#attachments .attachment-chip').count(), 2);
  // A cut file-list carries Preferred DropEffect=move. Attaching must preserve it.
  await desktop.evaluate(async ({ clipboard, ClipboardItem }) => {
    const data = {};
    for (const item of await clipboard.read()) for (const type of item.types) data[type] = await item.getType(type);
    data['electron application/osclipboard;format="Preferred DropEffect"'] = new Blob([new Uint8Array([2, 0, 0, 0])]);
    await clipboard.write([new ClipboardItem(data)]);
  });
  await page.locator('#new-chat').click();
  await page.locator('#prompt').focus();
  await page.keyboard.press('Control+v');
  await page.waitForFunction(() => document.querySelectorAll('#attachments .attachment-chip').length === 2);
  assert.ok((await stat(file)).isFile());
  assert.ok((await stat(folder)).isDirectory());
  assert.equal(await desktop.evaluate(async ({ clipboard }) => {
    const type = 'electron application/osclipboard;format="Preferred DropEffect"';
    for (const item of await clipboard.read()) if (item.types.includes(type)) return new Uint8Array(await (await item.getType(type)).arrayBuffer())[0];
  }), 2);

  let sent;
  await page.route('**/api/chats/*/message', async route => {
    sent = route.request().postDataJSON();
    await route.fulfill({ contentType: 'text/event-stream', body: `event: user\ndata: ${JSON.stringify({ id: 'attachment-message', role: 'user', content: 'Review attachments', attachments: sent.attachments })}\n\nevent: done\ndata: {}\n\n` });
  });
  await page.locator('#send').click();
  await page.locator('#messages .message-attachments').waitFor();
  assert.deepEqual(sent.attachments.map(item => item.type), ['file', 'directory']);
  assert.equal(await page.locator('#attachments').isVisible(), false);
  await page.screenshot({ path: path.join(temp, 'attachments.png') });
  assert.deepEqual(errors, []);
  console.log('PASS: native file/folder pickers, real-file and folder drops, clipboard preview, copy/cut file and folder paste, normal text/path paste, deduplication, send payload and message chips.');
  console.log('Screenshot:', path.join(temp, 'attachments.png'));
} finally { await desktop.close(); }
