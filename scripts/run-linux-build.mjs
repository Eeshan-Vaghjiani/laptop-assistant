import { mkdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output = path.join(root, 'releases/1.1.0/linux');
await mkdir(output, { recursive: true });
const version = JSON.parse(await readFile(path.join(root, 'node_modules/electron/package.json'), 'utf8')).version;
const verify = process.argv.includes('--verify');
execFileSync('docker', ['run', ...(verify ? ['--rm'] : ['--name', 'laptop-assistant-release-build']), '--security-opt', 'seccomp=unconfined',
  '--mount', `type=bind,source=${path.join(root, 'releases/1.1.0/build/linux')},target=/input,readonly`,
  '--mount', `type=bind,source=${path.join(root, 'scripts')},target=/scripts,readonly`,
  '--mount', `type=bind,source=${output},target=/output`,
  '-e', `ASSISTANT_ELECTRON_VERSION=${version}`, 'laptop-assistant-arch-builder:1.1.0',
  ...(verify ? ['bash', '-c', "pacman -U --noconfirm /output/*.pkg.tar.zst && runuser -u builder -- dbus-run-session -- xvfb-run -a -s '-screen 0 1280x1024x24' node /scripts/linux-release/verify.mjs"] : []),
], { stdio: 'inherit' });
