# The Desk V1

A full Electron, React and TypeScript rebuild of The Desk. Development is tracked in CS-2165. The V1 release-closure pass is **READY EXCEPT EXTERNAL BLOCKERS**: the local macOS artifact is installed and strict-code-sign verified, 238 domain tests and 10 extension tests pass, and all 49 bounded Electron smoke suites pass in development and against the installed app. The old Swift application has been removed from the working tree; Git history preserves historical context only.

## Development

Node 22.18 or newer is required. Run `npm ci`, `npm run check`, then `npm start`. `npm run package` produces a development application bundle. The development app uses its own identity and data directory.

Current slice: classes, explicit assignment capture, confirmed-deadline planning with adaptive duration ranges, assessment spacing, stable repair previews and deterministic what-if evaluation, local SQLite persistence, resource links, one active session, adaptive StudyActivity plans, quiz/exam contracts, evidence-safe session summaries, bounded Lens actions, account/sync boundaries, and a loopback browser-context bridge with a packaged MV3 extension. Notes now layers keyboard document flow, deterministic STEM math/graphs/data, paper/PDF attachments and chunked lecture recording metadata over the shipped Canvas renderer; iPad and automatic OCR/transcription remain device/integration gates. Live provider authentication, production cloud deployment, live Google/browser/voice flows, Windows interactive proof and the remaining contract are still explicit external or deferred gates.

Product authority: `docs/product/V1_PRODUCT_CONTRACT.md`. Completion evidence: `Verification/V1Completion.json` and its human-readable companion. Defects: `Verification/IssueLedger.json`.

The exact closure record is `Verification/RELEASE_CLOSURE.md`. It records the installed `app.asar` hash, package/signature evidence, smoke matrix, performance benchmarks, visual audit limits, and the external actions still required before public distribution.
