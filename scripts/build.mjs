import { packager } from '@electron/packager';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outputs = await packager({
  dir: root,
  out: path.join(root, 'dist'),
  name: 'Laptop Assistant',
  executableName: 'Laptop Assistant',
  platform: 'win32', arch: 'x64',
  overwrite: true,
  asar: false,
  prune: true,
  ignore: [/^\/\.data($|\/)/, /^\/\.git($|\/)/, /^\/\.github($|\/)/, /^\/tests($|\/)/, /^\/scripts($|\/)/, /^\/dist($|\/)/, /^\/releases($|\/)/, /\.log$/],
  win32metadata: { CompanyName: 'Personal', FileDescription: 'Laptop Assistant', ProductName: 'Laptop Assistant' },
});
console.log(`Standalone app: ${path.join(outputs[0], 'Laptop Assistant.exe')}`);
