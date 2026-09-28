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
node scripts/prepare-release.mjs win32
node scripts/build-installer.mjs
```

Output: `releases/1.1.0/windows/Laptop-Assistant-Setup-1.1.0-x64.exe`.

The installer is per-user and creates Desktop/Start menu shortcuts. It includes the SDK runtime and Copilot sign-in binary. It is not code-signed.

To test the release executable with a temporary profile:

```powershell
$env:ASSISTANT_VERIFY_EXE = "$PWD\releases\1.1.0\windows\win-unpacked\Laptop Assistant.exe"
node tests/verify-attachments.mjs
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

The release version is currently pinned to `1.1.0` in the packaging scripts. Update these together when preparing a new release. The source development manifest retains its original `1.0.0` version; the isolated release manifest supplies `1.1.0` to the installers.
