import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(path.join(root, 'scripts/release-tools/package.json'));
const { build, Platform, Arch } = require('electron-builder');
const release = path.join(root, 'releases/1.1.0');
await mkdir(path.join(release, 'windows'), { recursive: true });
const electronVersion = JSON.parse(await readFile(path.join(root, 'node_modules/electron/package.json'), 'utf8')).version;
await build({
  projectDir: path.join(release, 'build/win32'),
  targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64),
  config: {
    appId: 'com.local.laptopassistant', productName: 'Laptop Assistant', electronVersion,
    directories: { output: path.join(release, 'windows') },
    asar: false, npmRebuild: false, nodeGypRebuild: false,
    files: ['desktop/**/*', 'public/**/*', 'server.mjs', 'attachments.mjs', 'release.json', 'package.json', 'node_modules/**/*'],
    win: { target: ['nsis'], executableName: 'Laptop Assistant', signExecutable: false },
    nsis: {
      artifactName: 'Laptop-Assistant-Setup-1.1.0-x64.exe', oneClick: false,
      perMachine: false, allowElevation: false, allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: 'Laptop Assistant',
      deleteAppDataOnUninstall: false, runAfterFinish: true,
    },
  },
});
await writeFile(path.join(release, 'windows/INSTALL.txt'), 'Run Laptop-Assistant-Setup-1.1.0-x64.exe. Install for your Windows user.\r\nOpen Laptop Assistant from the Desktop or Start menu.\r\nYour existing Copilot CLI login is detected automatically. If needed, click Sign in to GitHub in the app and complete login with your own account.\r\nA GitHub account with Copilot access and an Internet connection are required.\r\nNode.js and a separate Copilot CLI installation are not required.\r\nThis community build is not code-signed; Windows may display an unknown-publisher prompt.\r\nUninstall from Windows Settings > Apps. Personal chats are retained.\r\n');
