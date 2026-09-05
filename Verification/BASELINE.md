# Electron rebuild baseline — 2026-09-05

Tracker: CS-2165. Branch: codex/desk-v1-electron. Base: c4bdbdfbe5c2fc82a80d4957f7c23bc1d0bca086. Canonical checkout: /Users/henry/Developer/TheDesk/repo.

The saved old local paths were absent. Remote main contained the Swift prototype. The rebuild branch removes all 72 tracked legacy implementation/configuration/test/visual-reference files following the user's explicit full-rebuild correction. Original history is retained. No installed prototype or personal academic data was deleted.

Passed: dependency installation with valid peer resolution; strict TypeScript; ESLint; four domain/planner scenarios; Vite and Electron main/preload production build; unsigned macOS arm64 directory packaging.

Passed development runtime smoke: class and task capture, Home Next, session start, pause/restart/resume, session-aware Lens freehand selection and dismissal, explicit completion, completed-task restart. `npm run test:desktop` reproduces this with an isolated temporary database and records video/screenshots under ignored `artifacts/smoke`.

The smoke is not the full V1 vertical: no AI, voice, external-screen interpretation, real integration, cloud sync, or installed Windows acceptance. Initial Lens is selection only. Package evidence is unsigned development packaging, not public distribution or updater acceptance.

Outstanding first-slice gaps include natural-input interpretation, deadline correction UI, planner preferences/learning, screen capture and actual Lens assistance, resource proof, installed-bundle smoke, and fuller graph. The completion map remains conservative; requirement groups must not be marked verified because one subpart passes.

Installed development proof: `/Users/henry/Applications/The Desk V1.app` (unsigned arm64) passes the same smoke using `DESK_EXECUTABLE` and an isolated temporary database. The live script records automated interaction video. Lens one-shot screen capture code has been added after the initial baseline; capture permission/granted-screen behavior remains unverified. No capture is performed until its explicit button is pressed.

Latest checkpoint: `npm run check` passes 27 tests including capture timezone/uncertainty, schema-1-to-2 migration, and provider error/usage contracts. Pasted-text capture is live-tested through review, explicit date-time confirmation and persisted provenance. The provider adapter uses injected fetch in tests; it has not produced a real API response. Lens UI's missing-key fallback passes live. Native screen capture, provider authentication, overlay grounding, voice and Windows remain unverified. Developer model cost estimates come from the provider's actual usage when present; no production economics measurement is claimed.
