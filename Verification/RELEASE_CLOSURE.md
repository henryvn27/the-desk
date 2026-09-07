# The Desk V1 release closure

Recorded 2026-09-07 on `codex/desk-v1-electron`.

Status: **READY EXCEPT EXTERNAL BLOCKERS**.

The Electron/React/TypeScript rebuild is the only V1 implementation surface. `npm run check:electron-only` passes and no Swift, Xcode project, or Xcode workspace file is present in the tracked implementation. The old Swift prototype remains only in historical Git context and product-contract notes.

## Evidence

- `npm run check` passes: Electron-only guard, strict TypeScript, ESLint, 238 domain tests, 10 extension tests, Vite/Electron production build, and MV3 extension build.
- `npm run package` passes for the macOS arm64 directory artifact. The final signed package contains `release/mac-arm64/The Desk V1.app/Contents/Resources/app.asar` with SHA-256 `95c5bda880bc59db607c41fd716df144f22e0315360becb249010247cd2dc99c`.
- Hosted workflow [34088140936](https://github.com/henryvn27/the-desk/actions/runs/34088140936) passes `npm ci`, `npm run check`, and `npm run package` on both macOS and Windows for commit `200096448fa9ca2a4f937e53f570259f7a6a3e10`. This is build/package evidence, not Windows interactive UI or permission proof.
- `/Users/henry/Applications/The Desk V1.app` matches that `app.asar` byte-for-byte. `codesign --verify --deep --strict` passes for the Apple Development identity. A rollback copy is preserved at `/Users/henry/Applications/The Desk V1.app.previous-20260907T053625Z-release-closure`.
- All 49 `scripts/smoke-*.mjs` suites pass in development and against the installed executable with isolated temporary data. This includes Capture, Inbox, Home, Planner, Classes, Units, Assessments, Grades, Sources, Notes, Canvas, Study, Lens, tutoring, browser bridge, account, sync, conflicts, migration/recovery, and restart persistence.
- `scripts/smoke-release-boundaries.mjs` passes with 414 generated build files and no credential-shaped build output. The synthetic OpenRouter boundary smoke passes without using a developer key.

## Benchmarks and visual review

- Capture: object-type, class-routing, due-date and auto-file precision are 1.0 on the evaluation corpus; review rate is 0.9333, mean Brier score 0.1572, mean parse time 3.287 ms, durable-store time 15.454 ms, and original text recovery passes.
- Notes: 600 blocks, 2,000 ink strokes and 800 graph samples parse in 13.87 ms; graph calculation is 43.99 ms.
- Library: 174,007 characters and 1,800 sections search in 0.23 ms; indexed search is 2.76 ms. Annotation indexing is the measured hotspot at 1,781.33 ms for 500 annotations.
- Home: the 10-scenario benchmark covers normal day, weekend, overload, exam tomorrow, nothing due, missed session, uncertain deadline, plan change, active session and offline.
- Planner and Class benchmarks pass with repaired-plan churn reduced to zero in the benchmark corpus and current/upcoming unit, assessment, learning, teacher, source and grade evidence visible.
- The Capture product audit is retained under `artifacts/audits/capture/`. It found one meaningful UX follow-up: after a capture files automatically, the Inbox confirmation should offer a direct “View filed item” affordance or select the Filed state. It did not block durability or routing.

## External blockers

1. Live OpenRouter authentication still returns a sanitized HTTP 401. No successful answer, usage, or provider privacy-account setting is claimed.
2. Production Supabase migration/RLS deployment, session refresh, and cross-client merge remain unverified. SQLite remains authoritative locally.
3. Live Google OAuth, real Chrome/Edge installation and permissions, Classroom/Drive/Calendar transport, voice/OCR/PDF device paths, and Windows interactive UI remain unverified.
4. The local artifact is development-signed and not notarized; `spctl` rejection is expected for this local directory build. Public signing/notarization is a separate release step.
5. QA-LENS-002 remains open because an earlier installed run observed an intermittent extra SVG path even though the closure rerun passed.

No credential value was printed, copied into source, included in the package, or used as synthetic test evidence.

## Architecture duplication audit

- Capture was extended through the existing Inbox, confidence policy, provenance, SQLite/outbox and planning boundaries; no second capture pipeline or storage silo was introduced.
- Notes and freeform work reuse the existing Canvas scene/renderer and canonical Source/Artifact/Provenance records; no second whiteboard or source database was introduced.
- Class, Unit, Teacher, Assessment, Grade and Study surfaces continue to use the V1 domain graph; no parallel Course or academic-object truth was introduced.
- Search continues through the shared Library/index boundary; no Notes-only search engine was introduced.
- Recording metadata, Lens actions, tutoring and study evidence remain on the existing main-process/session/intelligence boundaries.
- No Swift business logic or native parallel product was introduced. `apps/ipad` is a thin TypeScript renderer over shared Note/Canvas data and is outside the desktop V1 release claim.
