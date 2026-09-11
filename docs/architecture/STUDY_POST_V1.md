# Study quality after V1

The post-V1 study layer extends the shipped `StudySession`; it does not create a second Study database or a chat-only tutor. SQLite remains authoritative and the existing `Attempts`, `Mistakes`, `Student Model`, `Session Kit`, `Sources`, Notes and Lens paths remain the evidence and presentation boundaries.

## Shared activity contract

`packages/study/activities.ts` defines the value object persisted in `StudySession.activityState`. A plan contains `LEARN`, `CHECK`, `HINT`, `PRACTICE`, `QUIZ`, `EXAM`, `EXPLAIN`, `RECALL` and `CORRECT_MISTAKE` moves, their concept/source/mistake links, intended difficulty, response surface, hint policy, rationale and status. `planStudyActivities` uses the canonical Student Model to prefer prerequisite recall, low-retrievability retrieval, correction of recorded mistakes, transfer practice and assessment-linked checks. The mode is additive: `standard`, `quiz` and `exam` all use the existing session lifecycle.

Lens receives the same activity kind as an optional request context. Its trusted provider route adds the deterministic activity contract while preserving Guide me, Balanced and Explain directly. Notes can send the active document block to Lens with `CHECK`; the existing paper capture action uses the same Lens window and contract. No provider or tutor backend is duplicated.

## Integrity and evidence

`CHECK` requires an attempt before diagnosis and names the earliest meaningful issue. `HINT` is limited to one next step and never includes a final answer or later derivation. `EXPLAIN` can give the complete method when requested. Exam activities persist with no hints and deferred feedback. Marking an activity complete is progress metadata; only a checked `Attempt` updates the Student Model. Optional attempt metadata links activity IDs, response modes, difficulty and transfer distance without inventing outcomes. Existing mistake records remain intact.

Session end adds a deterministic summary to the existing session JSON. It separates time and the student's completion report from checked evidence, counts activity completion and hints, names a next action, and records caveats when no evidence exists. Review recomputes the summary after checked attempts are recorded. Duration learning continues to use the existing reviewed-session memory helper.

## Practice quality

Mistake practice still creates a normal optional-review task and updates `practiceTaskIds`. Its additive metadata records the source mistake, intended difficulty, variation key and validation status. Free-form mistakes are explicitly `manual-review` because they do not contain a machine-checkable answer. Deterministic numeric/symbolic answer comparison and unit checks are available for structured candidates; thin, ambiguous, duplicate and near-template candidates are rejected before task creation.

## Compatibility

Schema 41 is a compatibility fence for activity state, quiz/exam mode, session summaries and practice metadata. Legacy sessions and tasks parse without backfill. V1 Canvas/Notes scenes, recordings, paper originals, sources, attempts and mistakes remain in their existing tables and envelopes. A writer older than schema 41 fails closed rather than dropping activity or practice fields.

## Verification

The unit suite covers adaptive selection, prerequisite ordering, assessment mode contracts, answer leakage boundaries, practice quality, deterministic unit checks, session summaries, Lens request propagation and real SQLite session persistence. `packages/study/evaluation.ts` compares bounded V1/post-V1 policy observations across answer leakage, hint usefulness, diagnosis, repetition, transfer, citations, evidence correctness and completion; it does not pretend to be a live provider-quality score. Desktop smoke covers the rendered activity panel and Notes-to-Lens launch path. Migration smoke upgrades schema-1/schema-36 fixtures through schema 41 and still rejects future schemas.
