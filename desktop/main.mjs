import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readdir, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { existsSync } from 'node:fs';
import { createApp } from '../server.mjs';
import { resolveAttachments } from '../attachments.mjs';
import { createFileClipboard } from './file-clipboard.mjs';
import { createSignIn } from './sign-in.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
app.setName('Laptop Assistant');
app.setAppUserModelId('com.local.laptopassistant');
if (process.env.ASSISTANT_TEST_PROFILE) app.setPath('userData', process.env.ASSISTANT_TEST_PROFILE);
let window, instance, server, origin, signIn, quitting = false;
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.show();
    window?.focus();
  });
  app.on('before-quit', event => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    const timer = setTimeout(() => app.exit(1), 10000);
    void (async () => {
      try {
        signIn?.close();
        await instance?.close();
        server?.closeAllConnections();
        if (server) await new Promise(resolve => server.close(resolve));
      } finally { clearTimeout(timer); app.exit(0); }
    })();
  });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(async () => {
  try {
    Menu.setApplicationMenu(null);
    const dataDir = path.join(app.getPath('userData'), 'chats');
    await mkdir(dataDir, { recursive: true });
    // Import existing browser-app chats once, without replacing desktop history.
    if (!process.env.ASSISTANT_TEST_PROFILE && !existsSync(path.join(ROOT, 'release.json'))) {
      const legacy = app.isPackaged ? path.resolve(path.dirname(app.getPath('exe')), '../..', '.data') : path.join(ROOT, '.data');
      for (const name of await readdir(legacy).catch(() => [])) {
        if (/^[a-f0-9-]+\.json$/.test(name)) {
          await copyFile(path.join(legacy, name), path.join(dataDir, name), constants.COPYFILE_EXCL).catch(error => {
            if (error.code !== 'EEXIST') throw error;
          });
        }
      }
    }
    instance = await createApp({ dataDir });
    server = instance.app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    origin = `http://127.0.0.1:${server.address().port}`;
    window = new BrowserWindow({
      width: 1280, height: 900, minWidth: 720, minHeight: 580,
      title: 'Laptop Assistant', backgroundColor: '#212121', show: false,
      titleBarStyle: 'hidden', titleBarOverlay: { color: '#212121', symbolColor: '#dedede', height: 42 },
      webPreferences: { preload: path.join(ROOT, 'desktop/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    const trusted = event => event.sender === window.webContents && event.senderFrame?.url?.startsWith(`${origin}/`);
    signIn = createSignIn(() => instance.reconnect());
    ipcMain.handle('desktop:sign-in', event => {
      if (!trusted(event)) throw new Error('Untrusted window.');
      return signIn.start();
    });
    ipcMain.handle('desktop:sign-in-status', event => {
      if (!trusted(event)) throw new Error('Untrusted window.');
      return signIn.status();
    });
    const readClipboardFiles = createFileClipboard(clipboard);
    ipcMain.handle('desktop:read-text', event => {
      if (!trusted(event)) throw new Error('Untrusted window.');
      return clipboard.readText();
    });
    ipcMain.handle('desktop:clipboard-files', event => {
      if (!trusted(event)) throw new Error('Untrusted window.');
      return readClipboardFiles();
    });
    ipcMain.handle('desktop:resolve-attachments', (event, paths) => {
      if (!trusted(event)) throw new Error('Untrusted window.');
      return resolveAttachments(paths);
    });
    ipcMain.handle('desktop:choose-attachments', async (event, kind) => {
      if (!trusted(event) || !['file', 'directory'].includes(kind)) throw new Error('Invalid attachment request.');
      const result = await dialog.showOpenDialog(window, {
        title: kind === 'directory' ? 'Attach folders' : 'Attach files',
        properties: [kind === 'directory' ? 'openDirectory' : 'openFile', 'multiSelections'],
      });
      return result.canceled ? [] : resolveAttachments(result.filePaths);
    });
    ipcMain.handle('desktop:copy-text', (event, text) => {
      if (!trusted(event) || typeof text !== 'string' || text.length > 10000000) throw new Error('Invalid clipboard text.');
      return clipboard.writeText(text);
    });
    ipcMain.handle('desktop:choose-folder', async event => {
      if (!trusted(event)) throw new Error('Untrusted window.');
      const result = await dialog.showOpenDialog(window, { title: 'Choose a starting folder', properties: ['openDirectory'] });
      return result.canceled ? null : result.filePaths[0];
    });
    ipcMain.handle('desktop:open-link', async (event, url) => {
      if (!trusted(event) || typeof url !== 'string') throw new Error('Invalid link.');
      const parsed = new URL(url);
      if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Only web links can be opened.');
      await shell.openExternal(parsed.href);
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (url !== `${origin}/`) event.preventDefault(); });
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.webContents.on('will-prevent-unload', event => event.preventDefault());
    window.once('ready-to-show', () => window.show());
    await window.loadURL(origin);
  } catch (error) {
    dialog.showErrorBox('Laptop Assistant could not start', error.message);
    app.quit();
  }
  });
}
