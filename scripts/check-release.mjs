import { createRequire } from 'node:module';
import { readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export async function checkRelease() {
  const require = createRequire(path.join(root, 'scripts/release-tools/package.json'));
  const builderRequire = createRequire(require.resolve('app-builder-lib'));
  const { listPackage } = builderRequire('@electron/asar');
  const resources = path.join(root, 'releases/1.1.0/windows/win-unpacked/resources');
  const allowed = new Set(['desktop', 'public', 'server.mjs', 'attachments.mjs', 'runtime-env.mjs', 'release.json', 'package.json', 'node_modules']);
  for (const entry of listPackage(path.join(resources, 'app.asar'))) {
    const name = entry.replaceAll('\\', '/').replace(/^\//, '');
    if (!allowed.has(name.split('/')[0]) || name.split('/').includes('..')) throw new Error(`Unexpected release content: ${name}`);
  }
  const visit = async (dir, prefix = '') => {
    for (const name of await readdir(dir)) {
      const relative = prefix + name;
      const info = await lstat(path.join(dir, name));
      if (info.isSymbolicLink()) throw new Error(`Unexpected release link: ${relative}`);
      if (!/^(node_modules|node_modules\/@github)$/.test(relative)
        && !/^node_modules\/@github\/copilot-(sdk-)?win32-x64(?:\/|$)/.test(relative)) throw new Error(`Unexpected unpacked content: ${relative}`);
      if (info.isDirectory()) await visit(path.join(dir, name), relative + '/');
    }
  };
  await visit(path.join(resources, 'app.asar.unpacked'));
  if ((await readdir(resources)).includes('app')) throw new Error('Unexpected loose application directory.');
  console.log('PASS: Windows ASAR and unpacked native packages contain only allowlisted application content.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await checkRelease();
