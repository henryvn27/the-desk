# The Desk V1

A full Electron, React and TypeScript rebuild of The Desk. Development is tracked in CS-2165. This branch is an early implementation, not a finished or release-verified V1. The old Swift application has been removed; Git history preserves it.

## Development

Node 22.18 or newer is required. Run `npm ci`, `npm run check`, then `npm start`. `npm run package` produces a development application bundle. The development app uses its own identity and data directory.

Current slice: classes, explicit assignment capture, confirmed-deadline basic planning, local SQLite persistence, resource links, one active session, floating session controller, reported completion and a freehand selection overlay. Lens AI/voice, cloud sync and the remaining contract are not yet delivered.

Product authority: `docs/product/V1_PRODUCT_CONTRACT.md`. Completion evidence: `Verification/V1Completion.json` and its human-readable companion. Defects: `Verification/IssueLedger.json`.
