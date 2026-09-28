# Laptop Assistant

A desktop assistant for **Windows and Arch Linux**, powered by the official GitHub Copilot SDK. Chat, attach files and folders, search your laptop, and carry out tasks in a local desktop window.

## Download and install

**[Download the latest release](https://github.com/Eeshan-Vaghjiani/laptop-assistant/releases/latest)**

### Windows (Intel/AMD 64-bit)

1. Download `Laptop-Assistant-Setup-1.1.0-x64.exe`.
2. Run the installer, then open **Laptop Assistant** from the Desktop or Start menu.
3. Your existing Copilot CLI login is detected automatically. If needed, click **Sign in to GitHub** and authorize your own account using the displayed code.

The installer includes Electron, the Copilot runtime, and the login helper. No separate Node.js or Copilot CLI installation is required. This community build is unsigned, so Windows may display an unknown-publisher warning.

### Arch Linux (x86_64)

Download `laptop-assistant-1.1.0-1-x86_64.pkg.tar.zst`, then run:

```bash
sudo pacman -U ./laptop-assistant-1.1.0-1-x86_64.pkg.tar.zst
laptop-assistant
```

The app also appears in your application menu. Run it as your normal user. Pacman resolves the desktop-library dependencies; your desktop's keyring service provides the usual secure Copilot credential storage.

**Docker is not needed to install or run either version.** It is used only by the release build process to package and test Arch Linux on a Windows development machine.

## Account

You need an Internet connection and a GitHub account with Copilot CLI access. Models and usage allowances follow your own Copilot plan. A browser-only GitHub login may not be sufficient; use the in-app sign-in button if prompted.

Releases include no creator credentials, chats, or account configuration. Each user connects their own account. The app runs locally; prompts and relevant model context go to GitHub Copilot.

## Features

- Streaming chat with Markdown, code blocks, and copy-response buttons.
- Searchable conversation history and model selection.
- **Add files** and **Add folder** controls, drag-and-drop, and removable attachment chips.
- Clipboard preview and **Ctrl+V** for files/folders copied or cut in the file manager. Attaching a cut item does not move it.
- Native starting-folder picker, live tool activity, clarification questions, and **Stop**.
- **Ctrl+K** for a new chat; **Enter** to send; **Shift+Enter** for a new line.

The assistant runs with your OS account's access. Each SDK permission request asks for **Allow once**, **Deny**, or **Allow all for this chat**. Review the displayed command, paths, URL or tool arguments. Allow all lasts until app restart and can be reset in the chat header; organisation-managed restrictions still apply. The starting folder and approval UI are not an OS sandbox: an approved shell command can read, change or upload files. Stop denies waiting requests and cancels ongoing work; it does not undo completed actions.

## Personal data

| Data | Location |
| --- | --- |
| Windows chat history | `%APPDATA%\Laptop Assistant\chats` |
| Linux chat history | `~/.config/Laptop Assistant/chats` (or `XDG_CONFIG_HOME`) |
| Copilot state | The current user's Copilot storage, normally `~/.copilot` |
| Browser development history | `.data/` in the project |

Uninstalling retains personal chats. The distributable builds do not import the developer's legacy chat history.

Windows desktop chat files are encrypted using Electron safeStorage (Windows DPAPI); existing plaintext chats migrate on startup. Keep the original Windows account and Electron profile to read them. Web and Linux chats remain plaintext. Copilot's separate session/log files and attached originals are not covered by this encryption. Windows account permissions and disk encryption still matter; same-user malware and administrators are outside the app's protection boundary.

The app disables SDK session telemetry, session export, cross-session storage, optional OpenTelemetry exporters and automatic runtime updates using supported controls. Prompts and relevant context still go to GitHub Copilot. The native runtime may perform service/authentication diagnostics outside session telemetry; see [modifications.md](modifications.md) for audit limits and network verification. Renderer assets are local; web links open only when clicked.

## Development

Use Node.js 22.12 or newer (Node.js 24 LTS recommended):

```bash
npm ci
npm start
npm run check
npm test
```

Development uses your local Copilot login. Run `copilot login` if needed; the bundled sign-in helper is included by the installer build. `npm run start:web` provides browser-based development. Desktop file-manager integration requires the desktop app.

For web mode, open the private `http://127.0.0.1:<port>/#<token>` link printed in the terminal. The page removes the token from the address bar and keeps it in that tab's session storage for reloads. A new server launch needs its new link. Do not share the link: it grants access to your assistant. `/api/bootstrap` requires the token and returns only the home folder; the desktop app obtains its token through its private IPC bridge.

### Builds and tests

- `npm run build` creates the standalone Windows app in `dist/`.
- See **[BUILDING.md](BUILDING.md)** for the isolated Windows installer and Arch package build commands.
- `npm run test:attachments` runs native Windows attachment integration checks without sending a Copilot request. It uses a temporary profile and modifies the system clipboard during testing.
- `npm run test:desktop` is an **explicit live test** of the standalone Windows app and consumes a small amount of the signed-in Copilot account's allowance.
- The Linux build installs its package in a disposable Arch container and tests startup, attachments, clipboard, and sign-in-helper launch.

Release 1.1.0 passed Windows packaged-app attachment tests and installer archive integrity checks. The Arch package was installed and exercised as a non-root user in the test container. End-to-end OAuth authorization with a new user's account was not tested.

### Structure

- `desktop/`: Electron window, native dialogs, file clipboard, and sign-in bridge.
- `server.mjs`: local Copilot integration and streaming chat API.
- `attachments.mjs`: file/folder validation and metadata.
- `public/`: chat interface, styles, and sanitized Markdown rendering.
- `scripts/`: local packaging and isolated installer builds.
- `tests/`: API and desktop integration checks.

The app runs an internal loopback service on an automatically assigned port. The API uses same-origin checks and a per-launch token. The renderer is sandboxed with Node.js access disabled.
