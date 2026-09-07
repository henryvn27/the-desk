# Post-V1 Student Model

The Student Model is a deterministic interpretation service over the V1 evidence graph. It does not replace or duplicate the attempts, mistakes, concepts, sessions, teacher_evidence, assessments, or memories records. SQLite remains authoritative; packages/intelligence/student-model.ts recomputes derived state from a snapshot.

## Evidence audit

| V1 record | What is authoritative | How the model uses it |
| --- | --- | --- |
| Attempt | checked result, unaided/aided state, hints, concept links and timestamp | primary competence, retrieval, breadth and recency evidence |
| Mistake | student explanation, correction, confidence, source and review date | unresolved friction and cautious repeated pattern classification |
| Concept | class/task links, retention mode, explicit aggregate counters and manual review date | identity, scope, legacy fallback evidence and retention policy |
| StudySession | tracked time, explicit review and session-linked attempt IDs | optional confidence predictions; review notes alone never raise mastery |
| Teacher evidence | manually recorded score/feedback and explicit modeling choice | secondary provenance signal when the record is explicitly included |
| Assessment | explicit scope and preparation-task links | readiness scope; no grade or assessment metadata is treated as performance |
| Academic memory | explicit or confirmed duration memories | planning context only; it is not silently converted into mastery |

The model deliberately ignores Notes opens, explanation reads, AI answers, task completion and session duration as performance evidence. A session can only affect competence when it records a checked Attempt.

## Derived dimensions

Every concept receives separate values and evidence counts:

- **Competence** estimates performance on checked work. Unaided correct, partial, incorrect and unknown results stay distinct. Aided work is down weighted, repeated work on one task is down weighted, recent work is more useful, and optional future attempt metadata is used only when it is already present.
- **Retrievability** uses a bounded FSRS-inspired stability/retrievability calculation. It keeps difficulty, stability, lapses, last retrieval and a derived review date without pretending every concept is a flashcard.
- **Evidence confidence** reflects sample size, task breadth, unaided coverage and explicitly included teacher evidence. It is not a confidence interval or a fake preparedness percentage.
- **Transfer depth** measures whether checked work spans more than one task. A single familiar-form success cannot produce a strong transfer state.
- **Metacognitive calibration** pairs an optional 1–5 confidence prediction captured in a selected Study review with the linked checked Attempt result. It reports underconfidence, calibration or overconfidence as an explanation, never as a student personality score.

Preparedness remains categorical: not-ready, developing, mostly-ready, ready, or strong. A low retrievability score can lower readiness while leaving competence high, and a prerequisite gap can block readiness for an advanced concept.

## Canonical API

createStudentModel(snapshot, now) returns one service used by Planner, Study Kit, Concepts and Assessments:

- getConceptState
- getReviewDue
- getPrerequisiteGaps
- getAssessmentReadiness
- explainState
- getLikelyMistakePatterns
- recordConfidenceEvidence
- recommendLearningObjective

The module also exports the same named functions for non-UI callers and test fixtures. Planner no longer interprets persisted preparedness/counters by itself; Study Kit and Today consume the same service.

## Prerequisites and migration

V1 had concepts and task links but no concept-to-concept edge. The smallest extension is optional prerequisiteConceptIds on the existing Concept JSON record. The trusted store validates same-class links, self-links and cycles. No second graph or prerequisite table exists.

Study reviews may optionally store a confidence capture alongside the existing review object. It is additive JSON, not a new evidence table. Schema 40 is a compatibility fence so an older writer cannot reopen a database and silently discard prerequisite edges or confidence captures. Existing V1 records migrate without backfill or invented evidence.

## Validation

packages/intelligence/student-model.test.ts covers simulated students who know but forget, guess correctly, repeat a misconception, improve slowly, make one careless slip, under- or over-estimate confidence, have insufficient evidence, and both directions of prerequisite/application separation. It also compares stale V1 preparedness with derived state. The final test writes attempts and confidence through the real V1 DeskStore and recomputes the model from the resulting snapshot.

The implementation adds no parallel evidence architecture. The only persisted additions are the minimum relationship and confidence distinctions that V1 could not represent; competence, retention, mistake patterns, readiness, assessment scope and explanations remain derived.
