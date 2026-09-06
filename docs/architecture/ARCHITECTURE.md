# Desk V1 architecture

Decision 2026-09-05: full Electron/React/TypeScript rebuild. Legacy Swift and Python app code has been removed from this branch; history alone retains it. The attached product contract governs product behavior. No Swift app architecture or legacy runtime is used.

- Electron main owns SQLite, resource launching, global shortcuts and window lifecycle.
- Sandboxed, isolated React renderers receive only a narrow preload API. Zod validates commands in main. IPC verifies the main frame belongs to an owned window. External web pages never load inside a privileged window.
- `packages/domain` owns validated input and transactional persistence. Migration version is explicit; a future schema fails closed. A partial unique index enforces one active session even if application checks regress.
- `packages/planner` is deterministic. It handles confirmed deadlines, saved local study windows, a seven-day horizon, minimum useful blocks and honest unallocated work. Grade impact, dependency scheduling, locks, learning, multi-day spacing and time-zone preference are still open.
- Local outbox is durable intent only. It is NOT working Supabase sync. No cloud connection is claimed.
- Lens currently owns a temporary native transparent Electron window with freehand paths and session context. An explicit one-shot display capture is implemented but permission behavior remains unverified. Typed model requests and normalized teaching marks are implemented with contract tests; live credential-based response quality remains unverified. Voice remains unimplemented. Selection alone is not Lens acceptance.
- Domain entities are added through real vertical slices. Current tasks/classes/sessions are not the complete academic graph.

The tracked V1 surface is guarded by `scripts/check-electron-only.mjs`, which
fails `npm run check` if Swift, Xcode project, or Xcode workspace files appear.
Historical Swift references in the contract and completion records describe
what was removed; they are not executable product code.

Development identifier `com.henryvanness.thedesk.v1` and separate user-data directory isolate the new app from the installed prototype and real academic data. Release identity and migration require deliberate review before replacement.

Security reference: https://www.electronjs.org/docs/latest/tutorial/security

## Execution ownership

Root owns architecture, product interpretation, implementation, integration and release proof. One Luna max agent owns mechanical contract/completion-map extraction. Preferred GPT-5.3-Codex implementation route is not exposed by the collaboration tool; root performs this slice directly. No agent swarm or duplicate implementation lanes.
