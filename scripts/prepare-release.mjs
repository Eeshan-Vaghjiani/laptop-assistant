// Sharing builds use an explicit source allowlist, separate dependencies and a
// separate output tree. Never package .data, user profiles, or the existing dist.
import { mkdir, copyFile, readFile, writeFile, cp, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const platform = process.argv[2];
if (!['win32', 'linux'].includes(platform)) throw new Error('Usage: node scripts/prepare-release.mjs win32|linux');
const release = path.join(root, 'releases', '1.1.0');
const stage = path.join(release, 'build', platform);
await mkdir(stage, { recursive: true });
for (const file of ['server.mjs', 'attachments.mjs', 'package-lock.json']) await copyFile(path.join(root, file), path.join(stage, file));
for (const folder of ['desktop', 'public']) await cp(path.join(root, folder), path.join(stage, folder), { recursive: true });
const original = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const manifest = {
  name: original.name, productName: 'Laptop Assistant', version: '1.1.0', private: true,
  type: 'module', main: original.main, description: 'Personal desktop assistant powered by GitHub Copilot',
  author: 'Laptop Assistant', license: 'UNLICENSED',
  dependencies: { ...original.dependencies, '@github/copilot': '1.0.85' },
};
await writeFile(path.join(stage, 'package.json'), JSON.stringify(manifest, null, 2));
// This marker only exists in distributable builds; personal development keeps its
// existing one-time legacy history migration behavior.
await writeFile(path.join(stage, 'release.json'), JSON.stringify({ version: '1.1.0', distributable: true }));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
if (platform === 'linux' && process.platform !== 'linux') {
  console.log(`Linux source staged at ${stage}; dependencies will be installed natively in the build container.`);
  process.exit(0);
}
execFileSync(npm, ['install', '--omit=dev', '--ignore-scripts', `--os=${platform}`, '--cpu=x64', '--no-audit', '--no-fund'], { cwd: stage, stdio: 'inherit', shell: process.platform === 'win32' });
await access(path.join(stage, 'node_modules', '@github', `copilot-sdk-${platform}-x64`, 'package.json'));
await access(path.join(stage, 'node_modules', '@github', `copilot-${platform}-x64`, 'package.json'));
console.log(`Isolated release staging: ${stage}`);
