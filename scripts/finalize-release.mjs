import { mkdir, copyFile, readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRelease } from './check-release.mjs';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const release = path.join(root, 'releases/1.1.0');
await checkRelease();
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
Unsigned builds show an unknown publisher. Signed new builds may still show a
SmartScreen reputation warning. Check the publisher and SHA-256 before sharing.

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
Windows desktop chats use DPAPI encryption and require the original Windows
account/profile. Copilot's separate session/log files are not encrypted by this app.
Each permission request asks for approval. Allow all is per-chat until restart;
reset it in the chat header. Approved shell commands can change or upload files.

DOCKER
Docker was used only by the developer to build and test the Arch package in an
isolated Linux environment on Windows. You do NOT need Docker to install or run
either version. Neither app starts a container.

VERIFICATION
Packaged behaviour and fresh-account sign-in must be verified for this build.
SHA256SUMS.txt contains checksums for both installers.
In PowerShell run:
  Get-FileHash .\\Laptop-Assistant-Setup-1.1.0-x64.exe -Algorithm SHA256
Compare with SHA256SUMS.txt. Obtain the expected hash through a separate trusted
channel; a hash supplied alongside a tampered download is not proof of origin.
`);
console.log(`Ready to share: ${share}`);
