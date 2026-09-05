# Electron rebuild baseline — 2026-09-05

Tracker: CS-2165. Branch: codex/desk-v1-electron. Base: c4bdbdfbe5c2fc82a80d4957f7c23bc1d0bca086. Canonical checkout: /Users/henry/Developer/TheDesk/repo.

The saved old local paths were absent. Remote main contained the Swift prototype. The rebuild branch removes all 72 tracked legacy implementation/configuration/test/visual-reference files following the user's explicit full-rebuild correction. Original history is retained. No installed prototype or personal academic data was deleted.

Passed: dependency installation with valid peer resolution; strict TypeScript; ESLint; four domain/planner scenarios; Vite and Electron main/preload production build; unsigned macOS arm64 directory packaging.

Passed development runtime smoke: class and task capture, Home Next, session start, pause/restart/resume, session-aware Lens freehand selection and dismissal, explicit completion, completed-task restart. `npm run test:desktop` reproduces this with an isolated temporary database and records video/screenshots under ignored `artifacts/smoke`.

The smoke is not the full V1 vertical: no AI, voice, external-screen interpretation, real integration, cloud sync, or installed Windows acceptance. Initial Lens is selection only. Package evidence is unsigned development packaging, not public distribution or updater acceptance.

Outstanding first-slice gaps include broader natural-input interpretation, planner preferences/learning, live screen capture and actual Lens assistance, resource proof, and fuller graph. The completion map remains conservative; requirement groups must not be marked verified because one subpart passes.

Installed development proof: `/Users/henry/Applications/The Desk V1.app` (unsigned arm64) passes the same smoke using `DESK_EXECUTABLE` and an isolated temporary database. The live script records automated interaction video. Lens one-shot screen capture code has been added after the initial baseline; capture permission/granted-screen behavior remains unverified. No capture is performed until its explicit button is pressed.

Latest checkpoint: `npm run check` passes 27 tests including capture timezone/uncertainty, schema-1-to-2 migration, and provider error/usage contracts. Pasted-text capture is live-tested through review, explicit date-time confirmation and persisted provenance. The provider adapter uses injected fetch in tests; it has not produced a real API response. Lens UI's missing-key fallback passes live. Native screen capture, provider authentication, overlay grounding, voice and Windows remain unverified. Developer model cost estimates come from the provider's actual usage when present; no production economics measurement is claimed.

Task correction checkpoint: 28 tests, typecheck, lint and production build pass. The updated unsigned installed macOS bundle passes task-edit smoke: confirmed-deadline changes are rejected without approval; approved corrections survive restart and retain original capture provenance. Capture is paste-first with a separate manual path; source details collapse so actions fit in the inspected window. No full planner or Windows acceptance is implied.

Session review checkpoint: 29 tests plus typecheck/lint/build pass. Installed unsigned macOS smoke confirms one-click acknowledgment, optional work notes and remaining-time updates, restart persistence, and Library study history. Original measured duration is retained; review cannot overwrite estimates after a newer session or put remaining time on completed work. Screenshots and operated video captured. This is partial SESSION evidence: no automatic detection or mastery/attempt/mistake/preparedness learning is claimed.

Planning preferences checkpoint: 31 tests pass with schema-3 settings migration, preference persistence, invalid-window rejection, off-days and local DST boundaries. Installed macOS smoke verifies saved study hours/day selection/buffer survive restart and off-days yield no automatic blocks. The current planner remains same-day and deadline-first; grade impact, learned estimates, spacing, locked blocks and multi-day planning are incomplete.

Cross-platform automated checkpoint: GitHub Actions run https://github.com/henryvn27/the-desk/actions/runs/33997130565 succeeded on source commit effd09b05eef6132144abc09f9925f0581431562. Both windows-latest and macos-latest completed npm ci, npm run check and npm run package. This proves hosted build/test/directory-package validation, not Windows installed UI, native Lens, shortcuts, permission handling, signed distribution or updater acceptance.

Weekly planning checkpoint: 32 tests and installed macOS smoke pass. A seven-local-day horizon carries only remaining task minutes between available days, preserves deadlines and buffer, and reports work still outside the horizon. Plan displays real dates and saved preferences. This is computed planning, not persisted commitments, grade-aware priorities, spacing or lock support. Prior Windows CI covers effd09b; this weekly-planning change has not yet been run on Windows.

Source checkpoint: 33 tests plus typecheck/lint/build pass. Schema 4 adds first-class text sources with normalized class/task many-to-many links. Installed macOS smoke verifies capture, linked assignment, content search, rendered source reader and exact text/link persistence after restart. Linked text is also available in the main session panel; that panel source flow has not yet been separately exercised. File/web imports, source editing/undo, provider retrieval and full academic graph remain unfinished.
