# Capture quality post-V1

Capture quality is an extension of the shipped Capture Inbox path. SQLite,
the Inbox item, confidence policy, provenance envelope, sync/outbox commands,
auto-file transaction and authority rules remain the system of record.

## Evidence before edits

`packages/intelligence/capture-evaluation.ts` defines a 15-case corpus:
typed assignment, syllabus, worksheet, phone photo, whiteboard, handwritten
notes, screenshot, timetable, graded test, teacher message, web page, Google
Classroom page, spoken assignment, ambiguous image and a duplicate worksheet.
`scripts/benchmark-capture.mjs` writes the result to
`artifacts/capture/benchmark-latest.json`; the first run is preserved as
`artifacts/capture/benchmark-baseline.json`.

The shipped baseline recorded object-type accuracy 0.2667, class routing
accuracy 0.9333, due-date accuracy 0.8000, auto-file precision 0.2500,
review rate 0.7333, mean parse time 0.773 ms, mean Brier score 0.1899,
duplicate detection false and original-text recovery true. The post-V1 run
records object-type, class-routing and due-date accuracy at 1.0000, auto-file
precision 1.0000, review rate 0.9333, mean parse time under 1 ms, duplicate
detection true and original-text recovery true. The corpus uses a foreground
class hint for the whiteboard case; this is an existing context signal, not a
new routing store.

## Smallest extensions

- `CaptureDraft` has a deterministic `objectType` hint and calibrated field
  confidence. Syllabus, worksheet, rubric, lecture slide, timetable, graded
  work, teacher message, web page, handwriting and unknown captures stay in
  Inbox rather than being filed as assignments.
- Month-name dates are extracted as candidates. Dates without a year remain
  reviewable, and weekday prose such as office hours or a timetable is not
  silently treated as a deadline.
- Duplicate review compares normalized captured source text in addition to
  title/class. It never merges records or replaces a revision.
- The compact Capture dialog now acknowledges `Capture now`, supports the
  existing Cmd/Ctrl+Enter path, seeds from browser selection/page context, and
  reports that local persistence precedes classification. The browser route
  still uses the existing trusted bridge and `inbox.capture` command.
- Foreground class/session context is an optional medium-confidence hint on
  the existing parser context. It can improve routing without changing the
  original text or class authority.

Original text and source-file names remain on every Inbox draft. The new
object type is also carried into task `captureEvidence` when a capture is
accepted. Old drafts without the optional field continue to behave as V1
assignment drafts.

## Failure and boundary policy

Classification, OCR, provider access and future binary processors are allowed
to fail after the durable capture. The item remains recoverable in Capture
Inbox with its original text and a retry/review state. No global binary store,
scanner, OCR engine, confidence database or second Inbox was introduced here:
the existing Notes/Canvas Capture path remains the owner of original paper
assets and cleaned/OCR derivatives. That boundary is deliberate because the
benchmark exercised routing and text capture; it did not demonstrate a
measured need to replace the V1 asset pipeline.

## Replacement audit

This overhaul replaced no V1 Capture component. `capture.ts` and
`capture-policy.ts` were extended, `DeskStore` still performs the same
transaction, `CaptureInbox` still owns review/archive/undo, the SQLite outbox
and sync boundaries are unchanged, and browser context still enters through
the existing bridge. Any future paper, speech or share-surface work must add
derivatives and adapters behind these boundaries rather than creating a
parallel source or capture database.

## Verification

- `packages/intelligence/capture.test.ts` covers specialized hints, month
  dates, context routing, exact original text and non-deadline calendar prose.
- `packages/intelligence/capture-evaluation.test.ts` checks corpus coverage,
  calibration inputs, duplicate review and recovery.
- `packages/domain/capture-policy.test.ts` checks specialized review and
  source-content duplicate signals alongside V1 auto-file/undo behavior.
- `npm run benchmark:capture` records the measurable baseline/post-V1 result;
  its durable section includes a single-capture acknowledgment timing and a
  batch SQLite timing. `npm run typecheck` and the full repository test/build
  gates remain required.
