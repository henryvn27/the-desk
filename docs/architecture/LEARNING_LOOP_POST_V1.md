# Closed-loop learning intelligence

The Desk's learning loop is a read-only projection over the existing V1
academic graph. SQLite remains authoritative for `Task`, `Concept`, `Attempt`,
`Mistake`, `Assessment`, `StudySession`, `Source`, provenance, and planner
records. The projection is recomputable and does not create a second student
database.

## Recommendation policy

`packages/intelligence/learning-loop.ts` derives a typed `NextBestAction` with
an action kind, duration, confidence, expected value, completion criteria,
evidence IDs, source IDs, and inspectable factors. The deterministic order is:

1. keep an active StudySession moving;
2. protect a confirmed deadline inside 48 hours;
3. repair a repeated failure through its weakest prerequisite;
4. prepare for a near assessment using the weakest required concept;
5. retrieve a due concept, offering a test-out check when evidence is strong
   enough;
6. use the existing Planner block or abstain when the evidence is too sparse.

The existing `NextAction` projection remains for compatibility with V1 Home;
Home and class views can consume the richer projection without changing task or
session authority.

The Desk intelligence projection shares one Student Model instance across the
learning loop and class projection. Remediations, assessment readiness, and
incomplete loops are derived once per snapshot; test-out plans reuse that same
model instead of rebuilding it for each action card.

## Evidence boundaries

Elapsed time, opening Notes, reading a source, and completing a planner block
remain activity signals. They do not raise mastery. Checked Attempts carry the
learning signal, with unaided and transfer work receiving more weight in the
existing Student Model. The projection reports estimated tracked, engaged, and
evidence minutes with an explicit confidence label rather than pretending that
time is precise learning measurement.

## Test out and remediation

`buildTestOutPlan` selects two or three representative prompts from the
existing concept, linked task, and source context. The desktop panel records
the student's checked outcomes through the canonical `attempt.create` command;
there is no test-out table and no answer replacement. A passed check therefore
changes the same Student Model that drives future planning.

`deriveRemediations` escalates only after at least two recent unaided failures
and a repeated mistake, unresolved mistake, or prerequisite gap. When a
prerequisite is available, the recommendation targets it before repeating the
blocked concept.

## Incomplete loops and time windows

Ended sessions without a review or checked outcome, unresolved mistake
patterns, and near assessments without concept evidence are surfaced as small
actionable incomplete loops. `packAvailableTime` uses the same recommendation
projection and inserts a two-minute transition buffer; it is a planning helper,
not a second scheduler.

AI can enrich extraction, concept links, or generated explanations elsewhere,
but this projection, deadline protection, prerequisite traversal, test-out
recording, and offline fallback are deterministic and work without a provider.
