# Academic domain

The product contract §4 defines the required academic graph. This document describes the implemented subset and the invariants that additions must preserve. SQLite is authoritative locally; no cloud graph is implemented.

## Implemented objects

| Object | Storage and relationships | Evidence or authority |
|---|---|---|
| Class | `classes`; one class has many tasks | Student-entered name |
| Task | `tasks.class_id` foreign key; JSON payload; one task has many sessions | Student-confirmed title, due instant, estimate, optional HTTPS resource and notes |
| Source | `sources` plus `source_classes`/`source_tasks` join tables; many-to-many links | Exact pasted text and capture time; user-provided authority |
| Canvas / notebook | `canvases`, task foreign key, revision-checked scene; optional ordered pages with shared files/source links | Original drawing content; page identity and dimensions owned by Desk |
| Capture provenance | Optional task payload retaining original/source text, captured time, candidate dates, uncertainties and field confidence | Original user-provided text is retained through task corrections |
| Rebalance change | `plan_changes`, immutable before/after block records | Explicit approved preview; latest 50 records shown; all records retained |
| StudyBlock | `study_blocks`, task foreign key, stable ID and revision | Explicitly reserved time; lock changes and late scheduling require approval; elapsed time is not completion |
| StudySession | `sessions.task_id` foreign key; tracked start/pause/end and elapsed minutes | Clock measurement is separate from student-reported completion |
| Session review | Session payload with review time, notes and optional remaining minutes | Explicit student report; no submission or mastery inference |
| Planning preference | `settings` row `planning`; local study window, weekdays and buffer | Explicit student configuration |
| Proposed block | Computed planner output; not persisted | Deterministic seven-day suggestion, not a calendar commitment |
| AI run | `ai_runs`, feature and optional session id | Content-free provider usage and latency; unavailable usage is null |
| Outbox operation | `outbox`, entity id, operation and timestamp | Local change intent only; not sufficient data for cloud replication |

## Enforced invariants

- UUID identities remain stable through corrections. Class/task and task/session foreign keys reject orphan records.
- The database has at most one active session, enforced by a partial unique index. Command transactions include local outbox writes.
- Paused time is excluded from measured duration, including an end while paused. Review notes do not rewrite measured duration.
- Completion is the student's report. It proves neither submission nor understanding.
- Changing a confirmed deadline or revoking its confirmation requires explicit approval. Capture provenance survives the edit.
- Uncertain deadlines are excluded from automatic planning. Capacity respects the configured local same-day window and buffer.
- Remaining-time review cannot modify completed work or overwrite an estimate after a newer session of the same task.
- SQLite migrations are sequential and transactional. Schema 3 adds settings; schema 4 adds text sources and join tables; schema 5 adds Canvas records; schema 6 fences the notebook document format so older renderers cannot overwrite page content. Schema 7 adds saved study blocks; schema 8 fences cancellation-aware clients; schema 9 adds rebalance records. Opening a future schema fails closed.

## Required graph still missing

User identity, academic periods, tracks, units, teachers, assessments, artifacts/concepts, attempts, mistakes, persistent plan versions, grades/categories, durable memory, integrations and connection capabilities remain unimplemented. Many-to-many relationships among those objects must be represented explicitly as those vertical flows are added. Task notes and the single resource URL are not substitutes for the required graph.

The current local profile is not a multi-user security boundary. JSON payload persistence is not evidence that absent objects, synchronization, provenance corrections or confidence history are supported.

Verification: `packages/domain/store.test.ts`, `packages/planner/index.test.ts`, and installed smoke evidence described in `Verification/BASELINE.md`.

Saved blocks are retained across suggestion recalculation. Future reservations reduce remaining estimates and occupy capacity; elapsed blocks do not count as completed work. Explicit cancellation retains the block with a cancellation timestamp and revision; it requires approval, preserves assignment work, and releases scheduling capacity. A seven-day view supports dragging saved blocks between local calendar days while preserving their local start time. Drops prepare an edit for review; the same revision, conflict, locked-change and deadline checks apply on save. Exact time changes remain available through the form. Approved rebalance previews are generated in the main process, expire in two minutes, and reject any change to their planning inputs. Apply preserves locked/imminent blocks and atomically records replacements, additions and unscheduled work. The UI shows the latest 50 rebalance records. Autonomous replanning and complete manual-edit revision history remain open.


Task planning metadata records user-selected work kind (assignment, assessment preparation, optional review) and importance (low/normal/high). Missing legacy values mean required assignment and normal importance. Schema 10 fences clients that would drop those choices. The deterministic comparator protects required work before optional review, then same-window confirmed deadlines, recorded importance, assessment preparation, and deadline/order ties. Required overload excludes optional minutes. This is not expected-grade-impact optimization: grades, weights, mastery, prerequisites and learned estimates remain absent.
