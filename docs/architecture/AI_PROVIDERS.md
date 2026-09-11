# Desk AI provider modes

The Desk has one provider selection owned by the trusted Electron main process. The persisted `ai-provider` setting defaults to `desk-managed` and is changed only by an explicit Settings action. Chat, Lens and provider-backed Capture/academic inference ask the same `AIProviderRouter`; a feature does not choose a provider independently.

## Modes

- **Desk Managed** is the default. A configured HTTPS Desk gateway receives the bounded OpenAI-compatible request without a reusable provider secret in the client. The development launcher may use the local `.env.local` key for local verification only; packaged builds do not load it.
- **ChatGPT / Codex** is optional. The official `codex app-server` owns ChatGPT authentication and credentials. Desk starts a read-only, ephemeral, no-environment thread and receives only sanitized account status or answer text. Desk never reads Codex credential files or sends tokens to the renderer. Background classification stays deterministic/local while this mode is selected so a student does not spend Codex allowance on invisible work.
- **Bring Your Own Key** preserves the existing native file-import path. The key is encrypted with Electron `safeStorage` in the user-data directory and is read only by main-process routing. It is never part of renderer state, telemetry, source exports or packaged assets.

The selected provider is never replaced silently. If the chosen route is unavailable, the request returns a bounded provider error and local Notes, Sources, Planner and stored academic state remain usable. The UI offers an explicit switch to Desk Managed.

Provider status is a sanitized projection: availability, capabilities, model identity, account plan/label and authoritative rate-limit windows where the official runtime supplies them. It contains no credential material or raw provider errors.

Desk Managed usage telemetry remains content-free (`feature`, selected model, latency, success/failure, status, usage/cost when returned). Alpha has no paywall, checkout or usage gate.

## Focus-safe desktop verification

Desktop smoke tests can run without taking over the user's screen. Set
`DESK_TEST_BACKGROUND=1`; Electron keeps the main, Lens and compact controller
windows hidden, skips the native Lens hotkey, and ignores test-only show/focus
requests while Playwright continues to exercise the renderer and IPC boundary.

For the installed build:

```sh
DESK_EXECUTABLE='/Users/henry/Applications/The Desk V1.app/Contents/MacOS/The Desk V1' \
DESK_TEST_BACKGROUND=1 node scripts/smoke-desktop.mjs
DESK_EXECUTABLE='/Users/henry/Applications/The Desk V1.app/Contents/MacOS/The Desk V1' \
DESK_TEST_BACKGROUND=1 node scripts/smoke-openrouter.mjs
```

The tests save screenshots and videos under `artifacts/` and do not relaunch
the installed app into the foreground. Verify the frontmost application after
the run when testing on a shared workstation.
