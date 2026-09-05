# The Desk V1 roadmap

This roadmap turns the product contract in [V1_PRODUCT_CONTRACT.md](V1_PRODUCT_CONTRACT.md) into an evidence-driven build order for the new Electron V1. It is a dependency map, not a completion claim. At creation, every V1 item is unimplemented and unverified; the machine-readable and human-readable maps in `Verification/` are authoritative for status.

This branch is a full rebuild. No Swift/Apple product implementation belongs in the V1 working tree; any prior Swift `LearningHome` prototype is historical Git context only. The V1 target is Electron + React + TypeScript, with the desktop runtime, shared packages, services, and Chrome/Edge bridge treated as the implementation surface. Existing Electron/Vite files are scaffold evidence only until the relevant requirements have implementation, automated, live, macOS, and Windows evidence.

## Build order

| Phase | Outcome and scope | Depends on | Exit evidence |
| --- | --- | --- | --- |
| 0. Foundation | Electron shell; React/TypeScript/Vite; package boundaries; SQLite; Supabase boundary; auth; sync foundation; test harness; cost telemetry; flags; crash/logging; updater; CI | None | Clean installable baseline, typed boundaries, and reproducible build checks |
| 1. Academic core | Domain graph; Spaces; Classes/Tracks; periods; Tasks; Assessments; Sources; Concepts; Capture; Capture Inbox; Home; Library; basic planner | 0 | A real capture produces confirmed academic objects and a useful Home/plan state |
| 2. Real planner | Work units; grade impact; capacity; estimates; buffer; sleep; scheduling; drag/edit/lock; explanations; repair; deadline confidence; Calendar; duration learning | 1 | Deterministic scenarios and a real plan explain priorities and honest overload |
| 3. Study Session | Session state; Session Kit; resource launcher; floating controller; pause/resume/end; completion inference; evidence; planner feedback | 1, 2 | Start/leave Desk/work/end updates durable evidence |
| 4. Lens | Shortcut; push-to-talk; text Lens; capture; click/rectangle/freehand circle/multi-selection/no-selection; transparent teaching overlay; marks; follow-up; context; Canvas save | 3 | Installed desktop build explains a real external screen and preserves follow-up context |
| 5. Browser bridge | Chrome/Edge; native messaging; page/selection context; generic adapters; Khan; Quizlet; Classroom fallback | 0, 4 | Browser context works honestly and degrades to manual capture |
| 6. Canvas | Replaceable renderer; page/infinite modes; ink/tools; images/PDF; equations; lasso; Lens primitives; source links; persistence/export | 1, 4 | Canvas survives close/reopen and accepts real Lens marks |
| 7. Academic intelligence | Attempts; Mistakes; concept evidence; retention; preparedness; gradebook; teacher model; graded-work ingestion; practice; long-term memory | 1, 2, 3, 6 | Evidence-backed preparedness, inspectable mistakes, and durable memory affect planning |
| 8. Google hardening | Gmail; Classroom API where allowed; Drive/Docs; Calendar; capability UI; fallback ladder; conflicts | 0, 1, 2, 5 | Declared capabilities are honest under permissions, admin blocks, and conflicts |
| 9. Notebook adapter | Replaceable bridge; Python sidecar; source handoff; audio/video/study guide/mind map/artifact import; flag/degrade | 1, 6, 8 | Failure is isolated and imported artifacts retain Desk provenance |
| 10. Business/release | Free/Pro/trial; Stripe; fair use; cost dashboards; updates; onboarding; export/deletion/privacy; release hardening | 0-9 | Release gates A-O, installed daily-driver proof, and adversarial audit pass |

## Vertical slices

1. Capture input -> interpret -> confirm -> Task/Assessment/Source -> basic plan -> Home Next.
2. Home Next -> Start Session -> Session Kit -> external resource -> session context.
3. Session context -> Lens text/voice -> freehand circle -> visual explanation -> follow-up.
4. End Session -> evidence -> mistake/concept/duration updates -> tomorrow's plan explanation.
5. Add browser and Google fallbacks, Canvas persistence, and Notebook artifacts only after the core vertical remains usable when those services fail.

## Evidence and release order

Each phase must update `Verification/V1Completion.json`, `Verification/V1Completion.md`, and the issue ledger with implementation location, automated evidence, live evidence, macOS evidence, Windows evidence, and blockers. Source-fixed is not verified. A phase can be complete as an implementation dependency while V1 remains unfinished until the end-to-end vertical and all applicable release gates pass.

Release gates are evaluated in this order: build (A), core vertical (B), planner (C), Lens (D), Canvas (E), integrations (F), offline/sync (G), privacy/security (H), performance (I), accessibility/responsive desktop (J), install/update/restart (K), cost observability (L), macOS (M), Windows (N), then no open blockers (O). Windows interactive Lens/overlay/global-shortcut evidence is a hard requirement for a cross-platform V1 claim.

## Scope boundary

The contract defers mobile apps, full web replacement, social/collaboration/teacher/admin/parent-surveillance features, marketplace/templates, giant rich text, LMS/Drive/calendar replacement, custom renderer-from-scratch work, gamification/streaks, arbitrary desktop puppeteering, dozens of integrations, perfect handwriting recognition, and expanded pricing/family plans. The full list and IDs are in `Verification/V1Completion.json` under `deferredNonV1`.

## Initial state

The roadmap and completion maps start at zero V1 evidence by design. The legacy Swift prototype's tests, screenshots, installed app, or connector contracts do not satisfy Electron V1 requirements. The next implementation owner should establish the Electron foundation and the first real vertical while preserving the explicit platform and integrity boundaries in the contract.
