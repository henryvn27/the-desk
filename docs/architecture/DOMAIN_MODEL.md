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
| Grade category / entry | `grade_categories` class FK; `grade_entries` category FK; revision-checked correction | User-entered scores, distinct from teacher evidence and official grades |
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

User identity, academic periods, tracks, units, teachers, assessments, artifacts/concepts, attempts, mistakes, persistent plan versions, durable memory, integrations and connection capabilities remain unimplemented. Many-to-many relationships among those objects must be represented explicitly as those vertical flows are added. Task notes and the single resource URL are not substitutes for the required graph.

The current local profile is not a multi-user security boundary. JSON payload persistence is not evidence that absent objects, synchronization, provenance corrections or confidence history are supported.

Verification: `packages/domain/store.test.ts`, `packages/planner/index.test.ts`, and installed smoke evidence described in `Verification/BASELINE.md`.

Saved blocks are retained across suggestion recalculation. Future reservations reduce remaining estimates and occupy capacity; elapsed blocks do not count as completed work. Explicit cancellation retains the block with a cancellation timestamp and revision; it requires approval, preserves assignment work, and releases scheduling capacity. A seven-day view supports dragging saved blocks between local calendar days while preserving their local start time. Drops prepare an edit for review; the same revision, conflict, locked-change and deadline checks apply on save. Exact time changes remain available through the form. Approved rebalance previews are generated in the main process, expire in two minutes, and reject any change to their planning inputs. Apply preserves locked/imminent blocks and atomically records replacements, additions and unscheduled work. The UI shows the latest 50 rebalance records. Autonomous replanning and complete manual-edit revision history remain open.


Task planning metadata records user-selected work kind (assignment, assessment preparation, optional review) and importance (low/normal/high). Missing legacy values mean required assignment and normal importance. Schema 10 fences clients that would drop those choices. The deterministic comparator protects required work before optional review, then same-window confirmed deadlines, recorded importance, assessment preparation, and deadline/order ties. Required overload excludes optional minutes. This is not expected-grade-impact optimization: grade records now exist, but planner integration, mastery, prerequisites and learned estimates remain absent.


Schema 11 adds weighted grade categories and manual score entries. Category weights may be incomplete but cannot exceed 100%; scores are bounded to 0..possible points in this model. Class ownership and revisions protect corrections. The recorded-score model weights point-based category averages without silently renormalizing missing weight. Its range assumes recorded averages remain fixed and missing weight scores 0..100%. Future work, drop rules, extra credit, official grade reconciliation and screenshot extraction are not modeled.


Grade scenarios model one additional item with a user-supplied earned-point interval. They recalculate the selected category using recorded points plus hypothetical points, retain unknown weight in the range, and never write grade entries. Scenario drafts remain in renderer memory and are cleared on restart/class change. This does not model correlated future outcomes, dropped scores, extra credit, or official-grade policy.


Schema 12 adds optional assignment links to same-class grade categories and upcoming possible points. Potential influence measures the modeled course-percentage sensitivity to a 10-percentage-point score change, using the recorded category weight and points plus the upcoming item. It is not expected improvement. Ranking protects required work and earliest imminent deadlines, then explicit importance. Grade sensitivity divided by days to deadline (minimum one; flexible work seven) participates only when all eligible required work has grade context. Missing required context falls back to deadline/importance/assessment ordering. Grade inputs join the rebalance preview basis, so changes invalidate pending approval. Grade linkage is for upcoming items not already entered as scores.


Schema 13 introduces persisted Suggest/Auto-plan selection and automatic-block origin. Auto-plan is the default and reserves new confirmed captures three minutes ahead within available gaps, without moving existing blocks. Active-session captures and uncertain work remain proposals. Capture and its reservations/change record are transactional. Capture undo removes only untouched automatic blocks; edits/locks/cancellations prevent it. Switching modes does not rearrange commitments. Invalid persisted mode values fail closed. Plan change history includes automatic additions; broader automatic updates, deferred-session capture scheduling and Autopilot remain unimplemented.


Schema 14 persists deferred Auto-plan intent for confirmed captures made during an active session. Session end consumes that intent transactionally and reserves available gaps once. Switching to Suggest clears pending intent, including if the user later switches back. Any existing reservation/cancellation for the task is a manual override and prevents duplicate automatic work. Pending status is shown in the class task list. This resumes new captures only; general task-update/deadline/missed-block automation remains open.


Schema 15 preserves immutable session-start estimates (minutes, class, work kind and task revision). Assignment edits and remaining-time corrections advance the task revision; completion and scheduling bookkeeping do not. Legacy sessions retain no invented baseline. The local duration helper compares only reviewed, explicitly completed, unchanged single-session tasks with at least five tracked minutes. Three same-class/work-kind samples enable a median actual/estimate multiplier, rounded to five minutes and bounded to 5–2400. Capture offers explicit application before saving; it never overwrites an estimate automatically. This is duration evidence, not mastery, submission, time-of-day learning or a forecast of score gains. Multi-session tasks are excluded until a comparable total-work baseline exists.


Schema 16 fences completion corrections and session review revisions. `session.correct` requires both the task and session revisions from the opened form, rejects active or superseded sessions, and updates the latest task/session status atomically. Reopening requires an explicit remaining-work estimate; marking finished rejects remaining time. Recorded duration, end/start timestamps and the start estimate stay unchanged. A correction appends the prior completion report and prior review to session history; regular reviews advance the session revision so an older correction cannot overwrite them. The session query orders by SQLite row insertion order to identify the latest session independently of wall-clock changes. Reopened work returns to planning eligibility without silently editing saved blocks.


The Session Kit is a read-only projection of the current assignment and explicitly associated local sources. It separates sources linked to the task from class-wide sources with no task association; sources belonging only to another task are excluded even within the same class. The latest three nonblank ended-session review notes are shown for this task, using insertion order. The kit is available in a pre-start preview and in the main active-session surface; compact controller contents remain compact. HTTPS resource buttons use the existing trusted main-process task-resource boundary. The kit does not infer verified mistakes, mastery, checklist completion or readiness from notes.
