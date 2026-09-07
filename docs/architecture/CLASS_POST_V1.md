# Class experience post-V1

The Class experience is a read-only projection over the shipped academic graph. It does not introduce a Course model, a second Unit/Module model, a second Teacher model, or a second Assessment model.

## Canonical inputs

`deriveClassExperience(snapshot, classId)` joins the existing `Class` record to its `AcademicPeriod` and `Space` context, `Track`/`Unit` progression, `Task` and `Assessment` work, `Concept` learning evidence, `Source`/revision/annotation material, `Teacher` and `TeacherEvidence`, and reconstructed `GradeCategory`/`GradeEntry` evidence. It calls the existing deterministic Planner and Student Model rather than calculating a second priority or preparedness system.

The projection is intentionally non-persistent. User corrections continue through the existing Units, Teachers, Assessments, task editing, Authority, and gradebook flows. Provenance and confidence remain on their canonical V1 records, so sparse or conflicting captures are shown as reviewable attention instead of being silently normalized in the UI.

## Student-facing questions

- **What’s next** is the Planner's earliest executable class task, with an honest fallback for unscheduled work and a separate state when a captured deadline needs confirmation.
- **Where are we?** stages the existing Units in Past, Current, and Upcoming order. The current stage is the first unit with incomplete linked work; a class with no units stays visibly unstructured rather than inventing a progression.
- **What matters for learning** uses Student Model evidence for linked Concepts, including preparedness, evidence confidence, unresolved mistakes, and review timing. Recorded Concept status is displayed separately from derived preparedness.
- Assessment cards join existing units, concepts, sources, mistakes, planned preparation, and preparedness evidence. They do not create another test-prep record.
- Teacher context separates recorded teacher facts and evidence from derived emphasis. Grade evidence shows the reconstructed scored range and unknown categories without adding a new grade dashboard.

## Boundary and verification

Notes, Sources, assignments, reader links, Canvas deep links, and existing gradebook editing remain in their current product surfaces. The class page only composes them and routes corrections back to those surfaces. `scripts/benchmark-class.mjs` seeds a representative AP Physics graph through real V1 commands and verifies the projection joins; `scripts/smoke-class.mjs` drives the Electron class page and captures the rendered overview.

Any future ingestion improvement should update the canonical V1 graph and its provenance/confidence fields. It must not add a class-specific syllabus database or duplicate academic truth for presentation.
