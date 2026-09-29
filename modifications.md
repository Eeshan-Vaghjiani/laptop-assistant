# Laptop Assistant security changes

Branch: `feat/secure-app`. Audit date: 2026-09-28. Shared Windows version: 1.1.0.
Implemented approved changes; publisher identity was deferred, Store work is a plan, dependency upgrades and clipboard tests were declined. No commits, builds, release scripts, Docker scripts or live Copilot tests were run.

## 1. Sub-agent isolation
**What:** Exclude sub-agent replies from the main conversation.
**How:** `server.mjs` checks `event.agentId` and deprecated `data.parentToolCallId`; FakeSession regression in `tests/server.test.mjs`.
**Why:** SDK 1.0.14 places the agent marker on the event.
**Effect:** Sub-agent text is neither streamed nor saved as the main reply.

## 2. Unicode streaming and disconnect
**What:** Parse SSE containing U+2028/U+2029 and cancel failed readers.
**How:** `public/app.js` splits event blocks on literal newlines; catches call `reader.cancel()`.
**Why:** JavaScript regex dot/end anchors treated these Unicode characters as line breaks.
**Effect:** Unicode replies parse correctly; a failed renderer read closes the stream and cancels the run.

## 3. Large non-English prompts
**What:** Increase the JSON request limit to 1 MB.
**How:** `server.mjs`; regression sends 100,000 Chinese characters and expects HTTP 200 and `done`.
**Why:** Character limits do not equal UTF-8 or escaped JSON byte limits.
**Effect:** Long non-English prompts work; oversized combined prompt/attachment requests still receive a bounded 413.

## 4. Private API bootstrap
**What:** Remove unauthenticated token disclosure.
**How:** `server.mjs` returns token/home to its caller; authenticated bootstrap returns only home. `desktop/main.mjs`, `desktop/preload.cjs`, `public/app.js` use trusted IPC or a web fragment.
**Why:** Other local accounts/programs could previously obtain command-capable credentials over loopback.
**Effect:** Web users must open the printed `/#<token>` link; the fragment is removed and stored only in sessionStorage. Desktop credentials stay in memory. README and `tests/verify-live.mjs` updated.

## 5. Native runtime environment
**What:** Stop leaking Electron's Node-runner switch into normal tools.
**How:** `runtime-env.mjs` clears inherited `ELECTRON_RUN_AS_NODE`, enabling it only for an explicit `.js` CLI; server and sign-in helper use native binaries in packaged mode.
**Why:** Inherited Node mode prevented Electron applications opened by tools from showing windows.
**Effect:** Normal Electron application launch works; custom JavaScript CLI overrides are development-only with the packaged runAsNode fuse disabled.

## 6. Missing Copilot context
**What:** Recover a chat whose SDK session is confirmed missing.
**How:** `server.mjs` starts the client, checks metadata for `undefined`, creates new context and saves/emits the requested notice.
**Why:** A stale session ID permanently broke subsequent messages.
**Effect:** Conversation history remains visible; earlier model context is unavailable. Metadata/resume errors do not silently fall back; tests cover recovery, errors and resume.

## 7. Portable GUI test directories
**What:** Remove the author's private temporary-directory assumption.
**How:** `tests/verify-attachments.mjs` and `tests/verify-desktop.mjs` use `tmpdir()` directly.
**Why:** `mkdtemp` does not create missing parent directories.
**Effect:** Test setup works without `%TEMP%\opencode`; these GUI tests were not run.

## 8. Clean staging and pre-share validation
**What:** Remove stale staged files and validate before populating sharing output.
**How:** `scripts/prepare-release.mjs` removes only the selected stage; `scripts/check-release.mjs` checks ASAR roots/unpacked native packages; `scripts/finalize-release.mjs` calls it first.
**Why:** Deleted sources could survive staging and a failed check previously happened after copying.
**Effect:** Unexpected content fails before new share copies. The existing root allowlist is retained; this is not a recursive dependency source audit or proof that old share output is current.

## 9. Managed-account explanation
**What:** Explain organisation-managed permission refusal once per run.
**How:** The `server.mjs` permission wrapper saves/emits a notice and returns `user-not-available`; tests invoke it twice per run.
**Why:** `approveAll` throws with managed settings and previously left actions failing without explanation.
**Effect:** Managed restrictions remain enforced, including when this chat has Allow all enabled.

## B. API validation and browser boundary
**What:** Harden all API routes and input/error handling.
**How:** `server.mjs` mounts token middleware at `/api` (including case variants), uses `timingSafeEqual`, validates IDs/body types/field bounds and saved metadata, redacts error tokens, and returns generic JSON parser errors.
**Why:** The old path-prefix check missed Express case variants; malformed JSON can echo input in parser errors. Invalid fields could cause exceptions.
**Effect:** Tests cover anonymous/wrong-token requests, static/API Host/Origin/fetch-site rejection, malformed/oversized inputs and errors. UUID lookup cannot select a filesystem path.

## B. Local path handling
**What:** Reject NUL, oversized and explicit UNC/device-style input paths.
**How:** `attachments.mjs` and `server.mjs` validate before filesystem stat; attachment arrays remain limited to 100 and paths to 32,767 characters.
**Why:** Merely checking a network path can trigger outbound SMB authentication before any AI approval.
**Effect:** UNC attachments and starting folders are rejected. Mapped drives, filesystem links and approved shell commands still require user judgment; path checks are not a filesystem sandbox.

## B. Electron and renderer
**What:** Restrict every webContents and the IPC bridge.
**How:** `desktop/main.mjs` blocks navigation/redirects/subframes/windows/webviews/downloads and denies permission checks/requests. IPC requires the exact main frame. `preload.cjs` drops unused `isDesktop`.
**Why:** A second webContents or untrusted subframe must not acquire privileged IPC access.
**Effect:** Sandbox/contextIsolation remain enabled; Node integration stays off; packaged DevTools and spellcheck downloads are off. Links use bounded HTTP(S) `openLink`; Markdown uses DOMPurify and other output textContent; CSP has no unsafe-inline/eval and blocks frames/objects.

## B. Human action approval (approved)
**What:** Ask on each SDK permission request by default, including reads and unknown kinds.
**How:** `server.mjs` removes global allow-all, disables runtime read/tool auto-approval and unrestricted paths/URLs, queues questions, validates explicit choices, and fails closed if runtime permission configuration fails.
**Why:** Malicious content can induce commands or uploads; a system prompt alone cannot authorize or constrain tools.
**Effect:** `public/app.js`, `public/index.html`, `public/style.css` show full request details and Allow once/Deny/Allow all. Allow all is per-chat memory until restart, resettable in the header. Stop/disconnect denies queued requests. Existing runtime rules and operations that do not emit a permission request are not an OS-enforced boundary.

## B. Windows chat encryption (approved)
**What:** Encrypt application-owned Windows desktop chat JSON at rest.
**How:** `desktop/main.mjs` provides safeStorage/DPAPI to `server.mjs`; versioned encrypted envelopes and encrypted temporary files replace plaintext atomically after successful encryption.
**Why:** Plaintext prompts/replies/paths expose private data if storage is read by another account or offline.
**Effect:** Valid legacy chats migrate; decryption/encryption failure stops startup or saving without overwriting the original. Retain the Windows account and Electron profile. Web/Linux storage and Copilot's own history/logs remain outside this encryption; no claim of secure deletion of old disk blocks/backups.

## B. Privacy controls
**What:** Disable unnecessary supported telemetry/export/update features.
**How:** `runtime-env.mjs` removes optional OTel configuration, sets `COPILOT_OTEL_ENABLED=false` and `COPILOT_AUTO_UPDATE=false`; SDK/session flags disable session telemetry, remote export, shared session store, config discovery, file hooks and extensions.
**Why:** Inherited OTel endpoints could export data elsewhere, and the CLI helper otherwise permits automatic update downloads.
**Effect:** Both native subprocesses use the settings; sign-in also passes `--no-auto-update`. SDK already supplies that flag and bundles runtime files without runtime download. No interception of Windows security or unsupported telemetry workaround was added.

## B. Locked dependencies
**What:** Make shared dependency installs frozen and script-free.
**How:** `scripts/release-app/package.json`/`package-lock.json` record the existing release-only Copilot helper; staging and `scripts/linux-release/build.sh` use `npm ci --omit=dev --ignore-scripts`.
**Why:** The prior staged `npm install` could resolve new transitive versions; the root lock omitted the release-only helper.
**Effect:** No new runtime dependency or upgrade. An override keeps existing Koffi 3.3.1; all overlapping root/release locked versions match. Both production audits returned zero known vulnerabilities; npm audit is not a native-runtime/Chromium vulnerability audit.

## B. Fuses and ASAR (approved)
**What:** Enable seven security fuses and integrity-checked application packaging.
**How:** `scripts/build-installer.mjs` uses built-in electronFuses, ASAR with smartUnpack disabled, and explicit native-platform asarUnpack patterns; `desktop/main.mjs`/`sign-in.mjs` spawn unpacked binaries.
**Why:** Loose JS could be replaced and a signed Electron executable could otherwise act as a Node runner.
**Effect:** runAsNode/nodeOptions/nodeInspect/file privileges are off; cookie encryption/embedded integrity/onlyLoadAppFromAsar are on. Packaged native `.exe`/`.dll`/`.node` signing is requested with credentials. ASAR does not validate unpacked native files; signatures and Windows installation permissions remain essential.

## B. Signing and truthful metadata
**What:** Support unsigned builds and genuine environment-supplied signing.
**How:** `scripts/build-installer.mjs` uses standard CSC variables or `ASSISTANT_AZURE_SIGN_OPTIONS`; standard NSIS hooks sign app, uninstaller and installer, with forceCodeSigning when configured.
**Why:** Disabling signExecutable prevented signatures; fabricated publisher identity is not acceptable.
**Effect:** Product/description/version are consistent (1.1.0); publisher/author/copyright use `ASSISTANT_PUBLISHER`. Publisher was deferred, so Windows build stops until supplied and staged. No certificate/password is stored in source; no self-signing or root installation.

## B. Documentation and verification
**What:** Document compatibility, checksums, trust and remaining work.
**How:** `README.md`, `BUILDING.md`, generated share instructions and this file; `package.json` checks the new environment helper. Live test scripts explicitly answer approval prompts only during those opt-in tests.
**Why:** Old verification claims must not be presented as results for a newly hardened installer.
**Effect:** SHA256SUMS remains; Get-FileHash and a separate trusted channel are documented. This file is excluded from the shared installer's allowlist.

## Threat model

- **Assets:** user's files and shell, GitHub/Copilot login, chat history/attachments, per-launch API token.
- **Attackers:** other local programs/accounts reaching loopback; web pages using CSRF or DNS rebinding; malicious AI-read content inducing commands/exfiltration; installed-file tampering; vulnerable dependencies/Electron/Chromium.
- **Boundaries:** authenticated loopback, isolated renderer/validated IPC, runtime permission callbacks, Windows account ACLs, encrypted app history, signed/integrity-checked distribution.
- **Out of scope:** malware already running as the same Windows user or administrator. No app is absolutely secure.

## Privacy/network inventory and evidence limits

Application code uses only its loopback HTTP origin and SDK stdio. External browser navigation goes through explicit user clicks. No app analytics, crash uploader, auto-updater, remote fonts/scripts or remote Markdown images are configured. Clipboard file previews are local; paths reach Copilot only if attached/sent or read by approved tools. Plain paths entered as clipboard text are not attachments.

The bundled native runtime is opaque. The following is the official documented endpoint inventory relevant to GitHub/Copilot, **not a packet capture proving that this exact binary contacts every/only listed host**:

| Destination | Purpose/status |
| --- | --- |
| `github.com/login/*` (device/code/token flow), `api.github.com/user`, `api.github.com/copilot_internal/*` | Authentication, account/service configuration |
| `*.githubcopilot.com`, plan-specific `*.individual.githubcopilot.com`, `*.business.githubcopilot.com`, `*.enterprise.githubcopilot.com` | Model requests; resolved service endpoints depend on account |
| `copilot-proxy.githubusercontent.com`, `origin-tracker.githubusercontent.com` | Documented suggestion/code-reference services |
| `api.mcp.github.com` | GitHub MCP service when available/invoked as a tool |
| `collector.github.com`, `copilot-telemetry.githubusercontent.com/telemetry` | Documented telemetry; session telemetry disabled, no verified global opt-out for all authentication/runtime diagnostics |
| `default.exp-tas.com` | Documented Copilot experimentation service; actual use by this pinned runtime unverified; not an approved extra destination |
| `<enterprise>.ghe.com` and its subdomains | GitHub Enterprise Cloud data-residency alternatives |
| `github.githubassets.com`, `avatars.githubusercontent.com` | GitHub sign-in browser assets following user-clicked login |
| Arbitrary user-clicked HTTP(S) links and approved AI tool destinations | Outside the core service inventory; review before approval |

GitHub's broader allowlist also includes report-export Azure/CDN hosts and voice model-download Azure hosts. This app invokes neither feature. They are not additional app network permissions. Package registries and Electron download hosts are **build-time only**. SDK 1.0.14 `dist/client.js` uses native spawn/stdio with `--headless --no-auto-update`; `dist/runtimeArtifacts.js` resolves installed platform files; `cliVersion.js` pins runtime 1.0.85. No main-process fork dependency was found. Native runtime internals and all transitive subprocesses cannot be certified from these JS wrappers alone.

Official references: [Copilot allowlist](https://docs.github.com/en/copilot/reference/copilot-allowlist-reference), [CLI flags/environment and OTel](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference), [CLI configuration/state](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference), [SDK 1.0.14](https://www.npmjs.com/package/@github/copilot-sdk/v/1.0.14). Session telemetry opt-out is documented in installed SDK `dist/types.d.ts` (`enableSessionTelemetry`).

**Privacy release gate:** observe startup, authentication, idle and a controlled tool run in a disposable account using Microsoft TCPView/Process Monitor or an approved network capture. Correlate child PIDs and DNS/TLS destinations. Reject unexpected background destinations/downloads; investigate through official runtime controls. This audit does not claim a complete outbound firewall or a proven zero-telemetry runtime.

## Remaining risks

- Prompt injection still exists. An approved shell command or Allow all can expose every file/account accessible to the OS user and send data over the network. The SDK callback is not an OS sandbox and cannot police every child-process action or downloaded code inside an approved shell command.
- Explicit UNC/device paths are rejected, but mapped drives and links may reach remote storage. Original attachments are references, not encrypted copies.
- `%APPDATA%\Laptop Assistant\chats` did not exist on this machine. `icacls %APPDATA%` showed current user, SYSTEM and Administrators only; recipients' ACLs cannot be certified here. DPAPI does not protect against same-user malware, administrator compromise or stolen Windows credentials/master keys. Use disk encryption for broader offline protection.
- Copilot keeps separate session history/logs, credentials and tool-output artifacts. safeStorage encrypts only the app's chat files. GitHub processing/retention follows the user's plan and organisation policy; login helper may fall back to plaintext credentials if the OS credential store fails (official CLI behaviour).
- ASAR integrity covers packed application content, not unpacked native binaries, the Electron executable itself or every installation resource. Authenticode is not universal runtime signature enforcement. A writable/tampered installation remains dangerous; protect installation permissions and prefer Store-managed installation.
- Local denial-of-service, renderer/SDK/native vulnerabilities and supply-chain compromise remain possible. Zero npm advisories does not prove security. No rate/resource sandbox was added.
- Encrypted history is not directly portable to another account/PC; keep the Windows/Electron profile. Invalid/undecryptable encrypted data is preserved and causes a visible startup failure. Legacy invalid records may be skipped.
- Desktop URL/IPC restrictions, DPAPI, signed NSIS, ASAR native execution and runtime traffic require packaged verification. Versioned builder support was checked from [26.15.3 configuration](https://unpkg.com/app-builder-lib@26.15.3/out/configuration.d.ts), [Windows options](https://unpkg.com/app-builder-lib@26.15.3/out/options/winOptions.d.ts) and [NSIS source](https://unpkg.com/app-builder-lib@26.15.3/out/targets/nsis/NsisTarget.js); release tools were not installed or executed here.

## Windows warnings and legitimate distribution

### Identify the warning

1. Open **Windows Security → Virus & threat protection → Protection history**. Record the product, exact threat name, file path and SHA-256.
2. **SmartScreen reputation:** “Windows protected your PC” or “isn't commonly downloaded,” without a named antivirus detection. Every new unsigned build starts without inherited publisher reputation regardless of code quality. The reliable distribution routes are a trusted signature with established reputation or the Microsoft Store. Even newly signed files may warn while reputation accumulates; this is expected.
3. **Defender Antivirus detection:** a named threat such as `Trojan:Win32/...!ml`. Unsigned installers can trigger machine-learning false positives; the suffix alone does not prove a false positive. Inspect the artifact, remove suspicious traits, sign, and submit it for Microsoft review.
4. Submit the exact installer at [Microsoft Security Intelligence file submission](https://www.microsoft.com/wdsi/filesubmission): sign in, select **Software developer**, choose the detecting product, report incorrect detection, upload the file and include threat name, version, hash and reproducible details. Track the final result; use the developer contact form to dispute it if necessary. [Official submission guide](https://learn.microsoft.com/en-us/defender-xdr/submission-guide).

Never fix these warnings with code obfuscation/packing/encryption for scanner evasion, Mark-of-the-Web removal, exclusions, disabled protection, “Run anyway,” self-signed certificates or installed roots. ASAR is standard app packaging and chat encryption protects user data; neither is scanner evasion.

### Options compared (official guidance checked 2026-09-28)

| Route | Current facts | Recommendation |
| --- | --- | --- |
| Microsoft Store MSIX | Microsoft signs Store packages; Store-installed apps avoid SmartScreen download warnings. New individual onboarding at storedeveloper.microsoft.com has **no registration fee**; identity verification and account-type rules apply. | Preferred distribution goal; user approved a plan only. |
| Artifact Signing (formerly Trusted Signing) | Public Trust individual developers must be in **US or Canada**, with matching individual Azure billing/validated identity. Paid Azure subscription required; free/trial/sponsored subscriptions unsupported. Reputation still accumulates. | Preferred direct-NSIS signing option if eligible; user's location is unknown. |
| Commercial trusted OV/EV code-signing certificate | CA validation and secure key requirements apply; consult the CA for eligibility/pricing. Both accumulate reputation; **EV no longer grants an immediate SmartScreen bypass**. | Alternative for direct NSIS when managed signing is unavailable; do not pay for EV solely to remove warnings. |

Sources: [SmartScreen developer reputation guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation), [Store registration and current fees](https://learn.microsoft.com/en-us/windows/apps/publish/partner-center/open-a-developer-account), [Artifact Signing prerequisites](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart), [FAQ](https://learn.microsoft.com/en-us/azure/artifact-signing/faq), [current service pricing](https://azure.microsoft.com/pricing/details/artifact-signing/). No commercial price or personal eligibility is assumed.

### Approved Store/MSIX plan (not implemented)

1. Register through the new Store onboarding flow, reserve the app, and obtain the exact package identity/publisher values. Use truthful publisher identity; never substitute the NSIS app ID for Store identity.
2. Add a separate full-trust desktop package target/manifest and request applicable restricted capabilities (`runFullTrust`) for Store certification. Existing electron-builder supports AppX; use Windows SDK packaging tools for an MSIX submission as appropriate, without runtime downloads or new application dependencies.
3. Package Electron and native runtime together; spawn binaries from the installed read-only package, with writable state outside it. MSIX does not inherently forbid native child processes in a full-trust app, but package identity, working directory and security context must be tested.
4. Test AppData virtualisation for the chosen manifest/runtime behaviour: fresh installs, existing NSIS history/login, DPAPI profile keys, SDK state, upgrade/uninstall and shell writes. Virtualisation differs by app type/Windows version; redirected data can be removed on uninstall, unlike current NSIS retention.
5. Submit through Partner Center for certification/signing and test Store installation/update in a clean account. Store approval is not guaranteed for this app's capabilities. [Official packaged desktop behaviour](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes).

## Verification results

- `npm run check`: **PASS**.
- `npm test`: **PASS, 19 tests, 0 failures**. FakeClient/FakeSession; no Copilot allowance used.
- Node snippet: literal-newline SSE extraction round-tripped both U+2028 and U+2029.
- Syntax-only checks of release/check scripts and all three edited integration tests: **PASS**; this does not execute them.
- `npm audit --omit=dev`: **0 vulnerabilities**; `npm audit --omit=dev --prefix scripts/release-app`: **0 vulnerabilities**, including after lock alignment.
- Installed/locked Electron **44.4.5** matches the latest 44.x patch returned by npm at audit time. Direct production package registry versions match locked versions. No version upgrades approved or retained.
- Native DPAPI is tested by design inspection only; server storage tests use a real authenticated-encryption adapter to test migration/roundtrip/failure semantics, not to claim Windows DPAPI verification.
- No `npm run test:desktop`, `tests/verify-live.mjs`, clipboard test, build/release or Docker script executed. No commit/push.

## Exact follow-up commands

### Build and inspect (run yourself after supplying publisher)

```powershell
npm ci
npm ci --ignore-scripts --prefix scripts/release-tools
$env:ASSISTANT_PUBLISHER = 'YOUR ACTUAL PUBLISHER NAME'
# Supply signing credentials securely if available; see BUILDING.md.
node scripts/prepare-release.mjs win32
node scripts/build-installer.mjs
node scripts/check-release.mjs
$exe = "$PWD\releases\1.1.0\windows\win-unpacked\Laptop Assistant.exe"
$installer = "$PWD\releases\1.1.0\windows\Laptop-Assistant-Setup-1.1.0-x64.exe"
(Get-Item $exe).VersionInfo | Format-List ProductName,FileDescription,CompanyName,LegalCopyright,ProductVersion,FileVersion
(Get-Item $installer).VersionInfo | Format-List ProductName,FileDescription,CompanyName,LegalCopyright,ProductVersion,FileVersion
Get-AuthenticodeSignature $exe, $installer | Format-List Path,Status,SignerCertificate,TimeStamperCertificate
node --input-type=module -e 'import {createRequire} from "node:module"; import path from "node:path"; const r=createRequire(path.resolve("scripts/release-tools/package.json")); const b=createRequire(r.resolve("app-builder-lib")); console.log(await b("@electron/fuses").getCurrentFuseWire(process.argv[1]));' "$exe"
Get-FileHash $installer -Algorithm SHA256
```

Confirm all seven fuse values, signed identity/timestamps when configured, and 1.1.0 metadata. Install only in a disposable Windows account/VM; inspect the installed uninstaller using `Get-AuthenticodeSignature` with its actual path. Unsigned builds legitimately report NotSigned. Verify signatures on shipped native `.exe`, `.dll`, `.node` artifacts too.

Launch the packaged executable normally in that account. Test fresh sign-in, read/write/URL permission denial and acceptance, queued questions, Stop, Allow all/reset/restart, attachments and chat reload. Confirm encrypted envelopes on disk and verify another Windows account cannot decrypt copied chat/profile data. Inspect `icacls "$env:APPDATA\Laptop Assistant\chats"` and the installation directory; reject grants to unrelated accounts. Observe runtime network destinations as described above.

### Tamper test on a disposable copy only

After copying `win-unpacked` into a new directory inside the disposable VM, modify a byte of `server.mjs` inside that copy's ASAR using the installed ASAR module's offset metadata:

```powershell
$copy = 'C:\SecurityTest\tampered-app'
# Copy win-unpacked here in the disposable VM first; never use your installation.
node --input-type=module -e 'import fs from "node:fs"; import path from "node:path"; import {createRequire} from "node:module"; const r=createRequire(path.resolve("scripts/release-tools/package.json")); const b=createRequire(r.resolve("app-builder-lib")); const asar=b("@electron/asar"); const file=path.join(process.argv[1],"resources/app.asar"); const info=asar.statFile(file,"server.mjs"); const bytes=fs.readFileSync(file); const offset=8+bytes.readUInt32LE(4)+Number(info.offset); bytes[offset]^=1; fs.writeFileSync(file,bytes);' "$copy"
& "$copy\Laptop Assistant.exe"
```

Expected: integrity failure before normal startup. On another fresh copy, rename `resources\app.asar`; creating a loose `resources\app` must not restore launch. Unpacked-binary mutation is not covered by ASAR: use signature verification and report the actual OS enforcement behaviour rather than assuming it is blocked.

### Optional tests (explicitly consume allowance or change clipboard)

```powershell
node tests/verify-live.mjs
npm run test:attachments
```

The first is a live browser test consuming Copilot allowance and auto-answers its test approval prompts. The second launches the development Electron app and overwrites the clipboard. `npm run test:desktop` targets the older standalone `dist` package and requires debugging interfaces; it is not a verifier for this hardened installer. Do not enable packaged inspectors to make Playwright pass. Manual packaged verification is required.

After both Windows and Linux artifacts have been rebuilt and verified, run `node scripts/finalize-release.mjs`. It still expects both platforms; do not mix a fresh Windows installer with an unverified stale Linux package.

## Before sharing a build

- [ ] Recheck latest supported Electron 44 patch and advisories; audit the exact locked production graph.
- [ ] Supply truthful publisher; build from clean staging and frozen lockfiles with install scripts disabled.
- [ ] Run `npm run check`, `npm test`, `node scripts/check-release.mjs`; inspect ASAR/unpacked allowlist and all fuse values.
- [ ] Verify native runtime/login, permission decisions, DPAPI migration/account isolation, installer/uninstaller and update behaviour in a clean Windows account/VM.
- [ ] Verify traffic is limited to necessary GitHub/Copilot service calls, approved tools and user-clicked links; investigate unknown background traffic before release.
- [ ] Sign final app/native artifacts, uninstaller and installer using a validated identity; verify signatures/timestamps and scan the final artifact. Submit named false positives to Microsoft.
- [ ] Generate SHA256SUMS after signing; verify with Get-FileHash and send the expected hash through a separate trusted channel.
- [ ] Confirm share instructions match actual verification and signature state. SmartScreen may still warn for unsigned or newly signed low-reputation builds.
