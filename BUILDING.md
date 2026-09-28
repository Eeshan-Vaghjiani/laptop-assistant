# Building releases

The `dist/` app, local chat history, and installed account are separate from release output. Release staging uses an explicit application-file allowlist and installs its own dependencies. Do not run the installer on your development machine just to test packaging.

## Prerequisites

- Node.js 22.12+ and npm (Node.js 24 LTS recommended).
- Windows for the NSIS `.exe` build.
- Docker Desktop with Linux containers for the Arch build.
- Internet access to download npm dependencies, Electron, installer tools, and Arch packages.

From the project directory:

```powershell
npm ci
npm ci --prefix scripts/release-tools
npm run check
npm test
```

## Windows installer

```powershell
$env:ASSISTANT_PUBLISHER = 'Your actual publisher and copyright-holder name'
node scripts/prepare-release.mjs win32
node scripts/build-installer.mjs
node scripts/check-release.mjs
```

Output: `releases/1.1.0/windows/Laptop-Assistant-Setup-1.1.0-x64.exe`.

Replace the publisher example with your real identity; it was deliberately deferred during the audit. Windows packaging stops if the staged publisher is missing. Product and file versions are 1.1.0. The installer is per-user and creates Desktop/Start menu shortcuts. It includes the native SDK runtime and Copilot sign-in binary. Staging uses `npm ci --omit=dev --ignore-scripts` with `scripts/release-app/package-lock.json`. No install scripts run during that dependency install. Seven Electron fuses disable Node-runner/environment/inspector entry points, enable cookie encryption, remove extra file-protocol privileges, validate ASAR integrity and load app code only from ASAR. Native platform packages are unpacked and spawned from `app.asar.unpacked`.

Signing is optional: supply electron-builder's `CSC_LINK` and `CSC_KEY_PASSWORD` (or `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`) through your secure environment. For Azure Artifact Signing (formerly Trusted Signing), set `ASSISTANT_AZURE_SIGN_OPTIONS` to a JSON object containing `publisherName`, `endpoint`, `certificateProfileName`, and `codeSigningAccountName`; supply Azure authentication through its standard environment variables. Do not put secrets in the repository. The standard NSIS signing pipeline signs the app, uninstaller and installer; configured signing failures stop the build. Without credentials it builds unsigned. A signature does not guarantee immediate SmartScreen reputation.

The shared release disables packaged DevTools and Node inspection. Playwright's Electron launcher depends on these interfaces and cannot verify this hardened installer. Use a disposable Windows account/VM for manual installer, native runtime, attachment, sign-in and persistence checks. The automation below remains useful only for development executables with debugging enabled.

To run attachment automation on a development executable (modifies the clipboard):

```powershell
npm run test:attachments
```

## Arch Linux package

Start Docker Desktop, then:

```powershell
node scripts/prepare-release.mjs linux
docker build -t laptop-assistant-arch-builder:1.1.0 -f scripts/linux-release/Dockerfile scripts/linux-release
node scripts/run-linux-build.mjs
```

The build mounts staged application sources and build scripts read-only, with a separate writable output folder. It does not mount a home directory, account credentials, or chats. The container installs Linux dependencies natively, creates the pacman package, installs it, and runs non-root UI tests under a virtual display.

Output in `releases/1.1.0/linux/`:

- `laptop-assistant-1.1.0-1-x86_64.pkg.tar.zst` — recommended Arch installer.
- `Laptop-Assistant-1.1.0-linux-x64.tar.gz` — unpacked portable app, requiring the same desktop libraries.
- `verification.txt` and `linux-verified.png` — test results when verification succeeds.

To re-run checks on the existing package:

```powershell
node scripts/run-linux-build.mjs --verify
```

Before repeating the full build, remove its stopped build container:

```powershell
docker rm laptop-assistant-release-build
```

The builder uses `seccomp=unconfined` for Chromium's sandbox test inside Docker; this setting applies to the temporary build/test container, not to the distributed app. Docker is never a runtime dependency.

## Prepare files for sharing

After both packages pass their checks:

```powershell
node scripts/finalize-release.mjs
```

This creates `releases/1.1.0/Share with friend/` containing both installers, instructions, and SHA-256 checksums. Attach these files to a GitHub Release; generated binaries and build trees are excluded from Git history.

Check the installer with `Get-FileHash "releases/1.1.0/Share with friend/Laptop-Assistant-Setup-1.1.0-x64.exe" -Algorithm SHA256`. Compare it with `SHA256SUMS.txt`, and send the expected hash through a separate trusted channel. The allowed-files check runs before the share folder is populated.

The release version is currently pinned to `1.1.0` in the packaging scripts. Update these together when preparing a new release. The source development manifest retains its original `1.0.0` version; the isolated release manifest supplies `1.1.0` to the installers.

To intentionally refresh release dependencies after review, update `scripts/release-app/package.json` alongside the root manifest, then run `npm install --package-lock-only --ignore-scripts --prefix scripts/release-app`. Commit the reviewed lockfile with the source changes. Builds only consume that lockfile. See [modifications.md](modifications.md) for manual packaged checks, trust/distribution options and remaining risks.
