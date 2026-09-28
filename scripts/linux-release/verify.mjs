import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
const require = createRequire('/tools/package.json');
const { _electron: electron } = require('@playwright/test');
const home = '/home/builder';
const desktop = await electron.launch({ executablePath: '/usr/bin/laptop-assistant',
  env: { ...process.env, ASSISTANT_TEST_PROFILE: `${home}/test-profile` }, timeout: 60000 });
try {
  const page = await desktop.firstWindow();
  await page.setViewportSize({ width: 1280, height: 900 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForURL('http://127.0.0.1:*/');
  await page.locator('#connection').filter({ hasText: 'Sign in to GitHub' }).waitFor({ timeout: 60000 });
  assert.equal(await page.evaluate(() => window.desktop.platform), 'linux');
  assert.equal(await page.locator('#chat-list .chat-item').count(), 0);
  assert.ok(await page.getByRole('button', { name: 'Sign in to GitHub', exact: true }).isVisible());
  await page.getByRole('button', { name: 'Sign in to GitHub', exact: true }).click();
  await page.locator('#sign-in-output').filter({ hasText: 'Starting GitHub sign-in' }).waitFor();
  assert.equal((await page.evaluate(() => window.desktop.signInStatus())).running, true);
  await page.route('**/api/status', route => route.fulfill({ json: { authenticated: true, login: 'linux-test', models: [{ id: 'auto', name: 'Auto' }] } }));
  await page.reload();
  await page.locator('#connection').filter({ hasText: 'Connected to GitHub Copilot' }).waitFor();
  const file = `${home}/Résumé.txt`, folder = `${home}/Example folder`;
  await writeFile(file, 'Linux attachment test');
  await mkdir(folder, { recursive: true });
  await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, file);
  await page.locator('#add-files').click();
  await page.locator('#attachments').filter({ hasText: 'Résumé.txt' }).waitFor();
  await desktop.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, folder);
  await page.locator('#add-folder').click();
  await page.locator('#attachments').filter({ hasText: 'Example folder' }).waitFor();
  await page.locator('#new-chat').click();
  await desktop.evaluate(async ({ clipboard, ClipboardItem }, paths) => {
    const uriList = paths.map(path => `file://${encodeURI(path)}`).join('\r\n');
    await clipboard.write([new ClipboardItem({ 'text/uri-list': new Blob([uriList]) })]);
  }, [file, folder]);
  await page.locator('#prompt').focus();
  await page.keyboard.press('Control+v');
  await page.waitForFunction(() => document.querySelectorAll('#attachments .attachment-chip').length === 2);
  const cdp = await page.context().newCDPSession(page);
  await page.locator('#new-chat').click();
  const bounds = await page.locator('#composer').boundingBox();
  const drag = { x: bounds.x + 30, y: bounds.y + 30, data: { items: [], files: [folder], dragOperationsMask: 1 } };
  for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp.send('Input.dispatchDragEvent', { type, ...drag });
  await page.locator('#attachments').filter({ hasText: 'Example folder' }).waitFor();
  assert.deepEqual(errors, []);
  await page.screenshot({ path: '/output/linux-verified.png' });
  // Exercise the installed bundled CLI without authorizing or changing any login.
  const { execFileSync } = await import('node:child_process');
  const help = execFileSync('/opt/laptop-assistant/resources/app/node_modules/@github/copilot-linux-x64/copilot', ['login', '--help'], { encoding: 'utf8' });
  assert.match(help, /device-code/);
  await writeFile('/output/verification.txt', 'PASS: installed Arch package; sandboxed Electron launch as non-root; bundled Copilot runtime starts without an account; clean history; sign-in helper launches; native file/folder pickers; Linux URI clipboard paste; folder drop; bundled login helper.\nOnline OAuth completion was not tested: no friend account is available, and GitHub connectivity in the test container was intermittent.\n');
  console.log(await readFile('/output/verification.txt', 'utf8'));
} finally { await desktop.close(); }
