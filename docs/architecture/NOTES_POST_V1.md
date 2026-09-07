# Notes post-V1 architecture

This slice evolves the shipped V1 Canvas into Notes. The V1 scene envelope and Excalidraw adapter remain the freeform renderer; a document-flow envelope is additive beside the existing `elements`, `files`, notebook pages and source links. A legacy scene with no `document` still parses unchanged, while schema 39 is a compatibility fence so an older renderer cannot reopen a Notes scene and silently discard document blocks. Schema 40 separately fences the additive Student Model prerequisite and confidence fields. Schema 41 fences the shared StudyActivity state without introducing a second session store.

## What changed and why

| V1 limitation | Smallest extension | Owner |
|---|---|---|
| Keyboard students had to place floating text objects | `packages/canvas/notes.ts` stores ordered blocks for paragraphs, headings, lists, checks, code, math, tables, media, graphs and freeform regions | Shared domain + React flow editor |
| Equations had pixels but no semantic values | Bounded `mathjs` evaluation records variables, dependencies, units and configurable Suggest/Insert/Off results; the original LaTeX remains intact | `packages/canvas/semantic-math.ts` |
| A graph could not stay linked to a Note expression | Persistent graph blocks store expressions, optional source math block, parameters and viewport; deterministic sampling, roots, intersections, pan and zoom are shared helpers | `packages/canvas/graph.ts` |
| Notebook-scale numeric work was absent | Data blocks reuse the same document flow and deterministic helpers for tables, calculated columns, summaries, regression, histograms, boxplots and SVG plots | `packages/canvas/data.ts` |
| Search stopped at tasks and Sources | Main-process indexing now includes Note blocks, recognized paper text/math, graph expressions, recording transcripts and legacy Excalidraw text/math; results carry a block ID for deep linking | SQLite `DeskStore.search` |
| Capture had no paper attachment path | Notes can import bounded image/PDF bytes into the existing Canvas `files` envelope and keep a paper capture record with original bytes plus optional OCR/handwriting/math fields | Existing Capture/Sources boundary + Note document |
| Lecture audio was absent | The Notes toolbar records one-second MediaRecorder chunks through trusted main-process IPC into a per-user manifest directory; the Note keeps status, automatic Note-edit timestamps, manual markers and transcript segments | Electron main + shared Note metadata |
| V1 had no iPad target | `apps/ipad/src/NotesPad.tsx` is a thin touch/Pencil-friendly renderer using the same `CanvasScene` and `NoteDocument`; Excalidraw remains the freeform engine and host callbacks own persistence | Platform layer only; no Swift business logic |

## Canonical representation

`CanvasScene` is still the persistence boundary. `document` is optional and versioned at 1. Its block IDs are stable across edits and are the deep-link target for unified search. `captures` and `recordings` are optional arrays in the same document so a Note can carry semantic layers and navigation metadata without moving the authoritative local store out of SQLite. Binary paper/PDF bytes use the existing bounded `files` map; original bytes are never replaced by OCR or cleaned text.

Canvas saves remain optimistic and revision checked. The renderer debounces writes, preserves recovery copies, and keeps the existing page/infinite behavior. Switching to Freeform canvas remounts the same Excalidraw adapter; Notes is a presentation mode, not a second whiteboard.

Math and graph operations are deterministic. The LLM boundary is not involved in arithmetic, units, graph sampling or statistics. Math blocks keep LaTeX as the visual source and store semantic expressions/results separately. Graphs recompute from their persisted expression and scope whenever the source changes.

Recordings never send audio to a provider. Each accepted chunk is written before the next chunk is accepted, and finishing only changes the manifest after all queued chunks settle. While recording, document edits are throttled into durable Note-edit events with block IDs, so a marker can navigate from audio to the place the student was writing. If transcription or finalization fails, previously written chunks remain and the Note is marked interrupted. Transcript text is an explicit user or later provider output with timestamps; it is not inferred completion evidence.

## Verification and remaining gates

- Existing Canvas, notebook, math, source-link, close/reopen, stale-save and recovery paths remain covered by the V1 smoke scripts, updated to enter Notes and explicitly choose Freeform canvas for renderer-specific checks.
- Shared tests cover legacy scene compatibility, schema migration to 39, document operations, semantic math/unit errors, graph determinism, data helpers, captures/recording metadata and unified search deep links. The Notes smoke also proves a linked graph changes when its source math changes.
- `apps/ipad` compiles against the shared TypeScript contracts but has no native device harness in this repository. Physical Apple Pencil latency, palm rejection and iPad audio permissions still require a device/build target before release.
- Paper derivative generation and OCR recognition are represented as durable fields, while the current local implementation preserves the original and allows the student to enter/review semantic text. Provider/device OCR is a follow-up integration.
- Recording chunk persistence is implemented in the trusted Electron boundary; automatic transcription and transcript-to-block editing remain follow-up work. Audio loss is avoided on transcription failure.

## Duplication audit

No second canvas engine, rich-text database, Notes-only search index, scanner pipeline, or recorder window was introduced. NotesFlow delegates freeform work to the V1 Excalidraw scene, paper bytes to the existing Canvas file envelope, search to the existing SQLite store, and Lens actions to the existing source/task/artifact commands. The only new storage surface is the bounded recording chunk directory required because hour-long audio does not fit safely in a 20 MB Canvas scene.
