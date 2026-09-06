# Desk V1 architecture

Decision 2026-09-05: full Electron/React/TypeScript rebuild. Legacy Swift and Python app code has been removed from this branch; history alone retains it. The attached product contract governs product behavior. No Swift app architecture or legacy runtime is used.

- Electron main owns SQLite, resource launching, global shortcuts and window lifecycle.
- Sandboxed, isolated React renderers receive only a narrow preload API. Zod validates commands in main. IPC verifies the main frame belongs to an owned window. External web pages never load inside a privileged window.
- `packages/domain` owns validated input and transactional persistence. Migration version is explicit; a future schema fails closed. A partial unique index enforces one active session even if application checks regress.
- `packages/planner` is deterministic. It handles confirmed deadlines, saved local study windows, a seven-day horizon, minimum useful blocks and honest unallocated work. Grade impact, dependency scheduling, locks, learning, multi-day spacing and time-zone preference are still open.
- Local SQLite remains authoritative. The outbox stores an immutable schema-38 payload for each local operation, and the trusted Electron main process can append account-scoped copies to the approved Supabase operation-log table after authentication. Remote data is never applied silently; newer remote copies become preserved local conflicts that require an explicit decision. The production migration and remote-copy application remain separate release work.
- Supabase account configuration is read from process environment, or from `.env.local` only for an explicit un-packaged development run. The renderer receives account status only. Sessions are encrypted with Electron `safeStorage`; publishable credentials, access tokens and refresh tokens never enter renderer IPC or packaged resources.
- Browser context is a separate untrusted-data boundary. `packages/integrations/browser-bridge.ts` accepts only versioned Chrome/Edge page-context envelopes with bounded HTTP(S) URL, title, selection and visible text fields. The envelope can be formatted as Lens evidence, but it cannot carry commands, credentials or page-execution requests; an installed extension transport remains a separate integration task.
- Lens currently owns a temporary native transparent Electron window with freehand paths and session context. An explicit one-shot display capture is implemented but permission behavior remains unverified. Typed model requests and normalized teaching marks are implemented with contract tests; live credential-based response quality remains unverified. Voice remains unimplemented. Selection alone is not Lens acceptance.
- Domain entities are added through real vertical slices. Current tasks/classes/sessions are not the complete academic graph.

The tracked V1 surface is guarded by `scripts/check-electron-only.mjs`, which
fails `npm run check` if Swift, Xcode project, or Xcode workspace files appear.
Historical Swift references in the contract and completion records describe
what was removed; they are not executable product code.

Development identifier `com.henryvanness.thedesk.v1` and separate user-data directory isolate the new app from the installed prototype and real academic data. Release identity and migration require deliberate review before replacement. The sync table migration is tracked under `supabase/migrations/` and has not been applied to a production project from this desktop build.

Security reference: https://www.electronjs.org/docs/latest/tutorial/security

## Execution ownership

Root owns architecture, product interpretation, implementation, integration and release proof. Independent release slices may run in isolated worktrees when their file ownership is explicit; root alone updates completion-map and baseline evidence and performs the final merge and installed-build verification.
