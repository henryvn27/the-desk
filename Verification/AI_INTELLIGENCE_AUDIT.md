# Desk AI and intelligence audit

Recorded 2026-09-07 on `codex/desk-v1-electron`.

This is a post-V1 closure pass for missing intelligence boundaries. It extends the shipped Electron/TypeScript product and keeps SQLite, the existing academic graph, Canvas/Notes, Sources, Study Sessions, Lens, browser context and Capture Inbox as the canonical architecture.

## V1 surfaces inspected

- `packages/domain/contracts.ts` and `packages/domain/store.ts`: schema 42, SQLite snapshot, command validation, migrations, revisions, outbox and `ai_runs` telemetry.
- `packages/intelligence/student-model.ts`, `packages/learning/performance.ts`, `packages/learning/memory.ts` and `packages/study/*`: persisted attempts, mistakes, checked evidence, review state, prerequisite edges, assessment readiness and planner inputs.
- `packages/planner/home.ts` and `packages/planner/*`: canonical NEXT/TODAY/ATTENTION/UPCOMING/CONTINUE derivation and executable Study Session recommendations.
- `packages/intelligence/capture.ts`, `capture-policy.ts` and the Capture Inbox: durable first capture, confidence routing, provenance and user confirmation.
- `packages/intelligence/lens-provider.ts`, `grounding.ts` and `routing.ts`: main-process OpenRouter boundary, source authority, bounded context, strict output and privacy settings.
- Browser bridge, Sources/Library provenance, Notes/Canvas persistence, recording manifests, account/cloud sync boundaries and release smoke suites.

## Concrete gaps found

1. Capture had deterministic interpretation and the existing Inbox, but there was no shared inference contract that could be reused by Capture, Sources, Notes, browser context or future session input while preserving field-level provenance.
2. There was no generic, main-process structured-provider adapter for resolving only the ambiguities that deterministic inference could not settle. Lens had a provider boundary, but academic filing suggestions would have needed a second ad hoc path.
3. Lens grounding did not include a bounded Student Model interpretation. It could use source/task context, but it could not tell the model which learning objective or evidence-backed readiness state was relevant.
4. The renderer had no read-only intelligence projection that connected Home execution, class-level learning objectives, assessments and evidence counts without creating another persisted “AI state” model.

## Changes made

- Added `packages/intelligence/inference.ts`, a deterministic first pass with strict input validation, field-level confidence, source/revision/location provenance, conflict reporting, fingerprints, Capture enrichment and task reconciliation proposals. It never invents timestamps and never writes academic objects.
- Added `packages/intelligence/inference-provider.ts`, a strict OpenRouter JSON-schema adapter routed to FAST/Luna. It uses the approved-provider privacy envelope, a bounded request, one timeout and no retry/fallback. Main process owns the credential and validates the returned model identity.
- Added `desk:infer` and `desk:intelligence` to the existing main/preload API. `desk:infer` runs deterministic inference first, escalates only for critical ambiguity, applies only medium-confidence provider patches, and returns sanitized failure reasons. No key or provider choice crosses the renderer boundary.
- Added `packages/intelligence/desk-intelligence.ts`, a read-only projection over canonical Snapshot, Planner Home and Student Model state. It exposes one executable next action, actionable attention, class objectives, concept evidence, assessment readiness and explicit limitations. SQLite remains authoritative.
- Added the existing Student Model interpretation to Lens grounding with an explicit checked-work-only boundary. Lens instructions describe it as bounded evidence, not a verdict or substitute for a checked attempt.
- Added an explicit Capture review action for ambiguous fields. It preserves the original capture, marks AI suggestions for confirmation and uses the existing Inbox/provenance flow.
- Reused the existing `ai_runs` SQLite telemetry table for generic inference attempts. It records model identity, latency, success/failure code, HTTP status and token usage without storing prompts, raw provider errors or credentials.
- Added `scripts/benchmark-intelligence.ts` and `npm run benchmark:intelligence`. The benchmark exercises 5 classes, 50 tasks, 5 concepts, 20 attempts, 5 mistakes, 5 assessments and 100 deterministic inference inputs. It asserts provenance preservation, canonical evidence counts, no provider calls and no parallel store, then writes machine-readable metrics to `artifacts/intelligence/benchmark-latest.json`.

## Verification evidence

- Targeted inference, provider protocol, Desk Intelligence and Lens grounding tests pass.
- Strict TypeScript and targeted ESLint pass.
- The deterministic benchmark passes with the current fixture: 20 orchestration runs averaged 13.019 ms each; 100 inference inputs averaged 1.812 ms each with a 24.781 ms maximum. The benchmark does not call a provider or use a credential.
- Existing V1 tests remain the regression floor; full `npm test`, `npm run check`, packaging and installed-app smoke must pass before this audit is called release-ready.

## Integrity and scope limits

- AI suggestions remain advisory and user-confirmed. Provider output cannot overwrite high-confidence or confirmed facts.
- Mastery/readiness remains based on checked student evidence. Reading, model text or an unverified inference does not count as performance.
- No second Student, Course, Capture, Source or Notes database was added. No Swift business logic was introduced.
- Live provider quality, account-level OpenRouter logging settings, OCR/voice quality, external Classroom/Drive transport and production Supabase/RLS remain external verification surfaces. A sanitized provider failure is surfaced without losing the deterministic result or original evidence.
- Credentials are read only in the trusted main process and are not printed, bundled, sent through preload, included in tests, or written to artifacts.

## Replacement audit

No V1 subsystem was replaced. The new inference and intelligence modules are additive adapters over existing contracts; the existing Lens provider was extended only to include Student Model context. The benchmark and tests would fail if canonical evidence were bypassed or provenance were dropped.
