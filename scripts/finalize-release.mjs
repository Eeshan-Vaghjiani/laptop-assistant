import { mkdir, copyFile, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const release = path.join(root, 'releases/1.1.0');
const share = path.join(release, 'Share with friend');
await mkdir(share, { recursive: true });
const files = [
  ['windows/Laptop-Assistant-Setup-1.1.0-x64.exe', 'Laptop-Assistant-Setup-1.1.0-x64.exe'],
  ['linux/laptop-assistant-1.1.0-1-x86_64.pkg.tar.zst', 'laptop-assistant-1.1.0-1-x86_64.pkg.tar.zst'],
];
const sums = [];
for (const [source, name] of files) {
  await copyFile(path.join(release, source), path.join(share, name));
  sums.push(`${createHash('sha256').update(await readFile(path.join(share, name))).digest('hex')}  ${name}`);
  console.log(`${name}: ${((await stat(path.join(share, name))).size / 1024 / 1024).toFixed(1)} MiB`);
}
await copyFile(path.join(root, 'scripts/linux-release/INSTALL.txt'), path.join(release, 'linux/INSTALL.txt'));
await writeFile(path.join(share, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
await writeFile(path.join(share, 'READ ME FIRST.txt'), `Laptop Assistant 1.1.0 — Windows and Arch Linux (64-bit Intel/AMD)

WINDOWS
Double-click Laptop-Assistant-Setup-1.1.0-x64.exe and follow the installer.
Open Laptop Assistant from the Desktop or Start menu.
The installer includes the runtime; no separate Node.js or Copilot CLI is needed.
This build is unsigned, so Windows may display an unknown-publisher warning.

ARCH LINUX
Open a terminal in the folder containing the downloaded package and run:
  sudo pacman -U ./laptop-assistant-1.1.0-1-x86_64.pkg.tar.zst
Then open Laptop Assistant from the application menu or run laptop-assistant.
Pacman installs the desktop-library dependencies. Run the app as your normal user.

YOUR ACCOUNT
An existing Copilot CLI login on your computer is detected automatically.
Being signed in to github.com in a browser alone may not be enough.
If prompted, click Sign in to GitHub, open the GitHub sign-in page, and enter the
displayed code using YOUR account. Copilot access and Internet are required.
On Linux, use your desktop's keyring service for normal secure login storage.
Your models and usage allowance depend on your own Copilot plan.

FILES AND FOLDERS
Use Add files / Add folder, drag and drop, or copy/cut in your file manager and
Ctrl+V into the message box. Cut attachments do not move the original item.

PERSONAL DATA
No creator chats, credentials, or account configuration are included.
Chats and login are stored under the account of the person running the app.
Windows chats: %APPDATA%\\Laptop Assistant\\chats
Linux chats: ~/.config/Laptop Assistant/chats (or XDG_CONFIG_HOME)
Copilot maintains its own per-user login/session state.

DOCKER
Docker was used only by the developer to build and test the Arch package in an
isolated Linux environment on Windows. You do NOT need Docker to install or run
either version. Neither app starts a container.

VERIFICATION
Windows packaged-app attachment tests passed. The NSIS installer was built;
it was not installed over the creator's existing app.
The Arch package was installed and launched as a normal user in an isolated Arch
environment; runtime startup, attachments and clipboard tests passed.
Completing OAuth with a new friend's account was not tested.

SHA256SUMS.txt contains checksums for both installers.
`);
// A release root may contain ONLY app files and freshly installed dependencies.
const appRoot = path.join(release, 'windows/win-unpacked/resources/app');
const allowed = new Set(['desktop', 'public', 'server.mjs', 'attachments.mjs', 'release.json', 'package.json', 'node_modules']);
for (const name of await readdir(appRoot)) if (!allowed.has(name)) throw new Error(`Unexpected release content: ${name}`);
console.log('PASS: Windows release root contains only allowlisted application content.');
console.log(`Ready to share: ${share}`);
