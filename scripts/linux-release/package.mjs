import { createRequire } from 'node:module';
import { mkdir, writeFile, copyFile, chmod } from 'node:fs/promises';
const require = createRequire('/tools/package.json');
const { packager } = require('@electron/packager');
const [app] = await packager({
  dir: '/work/app', out: '/work', name: 'Laptop-Assistant', executableName: 'laptop-assistant',
  platform: 'linux', arch: 'x64', electronVersion: process.env.ASSISTANT_ELECTRON_VERSION,
  asar: false, prune: false, overwrite: false,
});
await mkdir('/work/package', { recursive: true });
await writeFile('/work/package/PKGBUILD', `pkgname=laptop-assistant
pkgver=1.1.0
pkgrel=1
pkgdesc='Personal desktop assistant powered by GitHub Copilot'
arch=('x86_64')
license=('custom')
depends=('gtk3' 'nss' 'alsa-lib' 'libxss' 'libsecret' 'xdg-utils' 'git' 'openssh' 'mesa' 'libdrm' 'libxkbcommon')
options=('!strip' '!debug')
package() {
  install -dm755 "$pkgdir/opt/laptop-assistant" "$pkgdir/usr/bin" "$pkgdir/usr/share/applications" "$pkgdir/usr/share/icons/hicolor/scalable/apps" "$pkgdir/usr/share/licenses/laptop-assistant"
  cp -a '${app}/.' "$pkgdir/opt/laptop-assistant/"
  chmod 755 "$pkgdir/opt/laptop-assistant"
  chmod 4755 "$pkgdir/opt/laptop-assistant/chrome-sandbox"
  ln -s /opt/laptop-assistant/laptop-assistant "$pkgdir/usr/bin/laptop-assistant"
  install -m644 /work/package/laptop-assistant.desktop "$pkgdir/usr/share/applications/laptop-assistant.desktop"
  install -m644 '${app}/resources/app/public/icon.svg' "$pkgdir/usr/share/icons/hicolor/scalable/apps/laptop-assistant.svg"
  install -m644 '${app}/LICENSE' "$pkgdir/usr/share/licenses/laptop-assistant/Electron-LICENSE"
  install -m644 '${app}/LICENSES.chromium.html' "$pkgdir/usr/share/licenses/laptop-assistant/LICENSES.chromium.html"
}
`);
await writeFile('/work/package/laptop-assistant.desktop', `[Desktop Entry]
Name=Laptop Assistant
Comment=Personal assistant powered by GitHub Copilot
Exec=laptop-assistant
Icon=laptop-assistant
Terminal=false
Type=Application
Categories=Utility;Office;
StartupWMClass=Laptop Assistant
`);
// npm --ignore-scripts is safe for these prebuilt distributions; ensure native
// executables keep executable permissions when staging originated on Windows.
for (const target of [
  `${app}/resources/app/node_modules/@github/copilot-linux-x64/copilot`,
  `${app}/resources/app/node_modules/@github/copilot-sdk-linux-x64/prebuilds/linux-x64/copilot-runtime`,
]) await chmod(target, 0o755);
await copyFile('/scripts/linux-release/INSTALL.txt', `${app}/INSTALL.txt`);
await chmod(app, 0o755);
