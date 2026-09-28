import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(path.join(root, 'scripts/release-tools/package.json'));
const { build, Platform, Arch } = require('electron-builder');
const release = path.join(root, 'releases/1.1.0');
const manifest = JSON.parse(await readFile(path.join(release, 'build/win32/package.json'), 'utf8'));
if (!manifest.author || typeof manifest.author !== 'string' || !manifest.author.trim()) throw new Error('Set ASSISTANT_PUBLISHER to your truthful publisher/copyright-holder name and stage again.');
await mkdir(path.join(release, 'windows'), { recursive: true });
const electronVersion = JSON.parse(await readFile(path.join(root, 'node_modules/electron/package.json'), 'utf8')).version;
const azureSignOptions = process.env.ASSISTANT_AZURE_SIGN_OPTIONS ? JSON.parse(process.env.ASSISTANT_AZURE_SIGN_OPTIONS) : undefined;
const signing = !!(process.env.WIN_CSC_LINK || process.env.CSC_LINK || azureSignOptions);
await build({
  projectDir: path.join(release, 'build/win32'),
  targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64),
  config: {
    appId: 'com.local.laptopassistant', productName: 'Laptop Assistant', electronVersion,
    copyright: `Copyright © ${new Date().getFullYear()} ${manifest.author}`,
    directories: { output: path.join(release, 'windows') },
    asar: { smartUnpack: false }, asarUnpack: ['node_modules/@github/copilot-sdk-win32-x64/**/*', 'node_modules/@github/copilot-win32-x64/**/*'],
    npmRebuild: false, nodeGypRebuild: false,
    buildVersion: '1.1.0', forceCodeSigning: signing,
    electronFuses: {
      runAsNode: false, enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false, enableCookieEncryption: true,
      grantFileProtocolExtraPrivileges: false,
      enableEmbeddedAsarIntegrityValidation: true, onlyLoadAppFromAsar: true,
    },
    files: ['desktop/**/*', 'public/**/*', 'server.mjs', 'attachments.mjs', 'runtime-env.mjs', 'release.json', 'package.json', 'node_modules/**/*'],
    win: { target: ['nsis'], executableName: 'Laptop Assistant', signExecutable: signing, signExts: ['.dll', '.node'], ...(azureSignOptions ? { azureSignOptions } : {}) },
    nsis: {
      artifactName: 'Laptop-Assistant-Setup-1.1.0-x64.exe', oneClick: false,
      perMachine: false, allowElevation: false, allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: 'Laptop Assistant',
      deleteAppDataOnUninstall: false, runAfterFinish: true,
    },
  },
});
await writeFile(path.join(release, 'windows/INSTALL.txt'), `Run Laptop-Assistant-Setup-1.1.0-x64.exe. Install for your Windows user.\r\nOpen Laptop Assistant from the Desktop or Start menu.\r\nYour existing Copilot CLI login is detected automatically. If needed, click Sign in to GitHub in the app and complete login with your own account.\r\nA GitHub account with Copilot access and an Internet connection are required.\r\nNode.js and a separate Copilot CLI installation are not required.\r\n${signing ? 'This build is code-signed; a new file may still receive a SmartScreen reputation warning.' : 'This build is unsigned; Windows may display an unknown publisher or SmartScreen reputation warning.'}\r\nVerify the SHA-256 with Get-FileHash and obtain the expected hash through a separate trusted channel.\r\nUninstall from Windows Settings > Apps. Personal chats are retained.\r\n`);
