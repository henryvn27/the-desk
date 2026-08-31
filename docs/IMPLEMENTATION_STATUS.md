# The Desk implementation status

Status date: 2026-08-30

## Implemented foundation

| Area | Implemented boundary |
| --- | --- |
| Native product | Adaptive SwiftUI Mac three-column workspace; iPhone tabs; iPad-compatible Canvas and practice UI; shared app icon catalog. |
| Local model | Classes/tracks, sources and immutable revisions, anchors, assignments/evidence, sessions, mastery, provider runs, canvases/history, integrations, Khan check-ins, and idempotent jobs. Large extracted text is stored outside the small transactional metadata snapshot; legacy inline libraries migrate on load, and failed/recovery stores reject mutations visibly. |
| Capture and sync | Files, photos, notes, links, and recordings; durable device outbox; content-deduplicated sources plus unique repeatable question/visualization operations; crash-safe v1 queue compatibility; paginated retries, renewable leases, stale-worker recovery, ownership checks before side effects, verified asset staging/cleanup, and a privacy-filtered companion mirror. Oversize text is rejected visibly rather than truncated. |
| Ingestion | Content-addressed SHA-256 originals, same-space deduplication without losing cross-class assignment, per-kind safe import limits, incremental PDF checkpoints, PDF text plus scanned-page Vision OCR, Speech timestamp anchors, and bounded DOCX/PPTX/EPUB extraction with archive-bomb defenses. |
| Retrieval | Rebuildable persistent SQLite FTS5 index with page/time parsing, automatic import indexing, and query-relevant tutor context. |
| AI harness | Codex app-server with ChatGPT account auth; OpenAI, Anthropic, Gemini, and local-preview adapters; Keychain keys; manual provider fail-closed behavior; provider-reported model IDs; visible rate-limit errors with no silent switch. |
| Study Canvas | Provider-generated and locally validated versioned scenes, concept map and parameter-lab rendering, in-place editing, PNG/PDF export, source citations, practice transformations, accessibility summary/table, staleness review diff, and restorable history. |
| Study Buddy | After one explicit target confirmation, holding Option-Space listens without activating The Desk and releasing takes one ScreenCaptureKit snapshot; OCR, validated overlay schema, class grounding, cursor-following streaming answer, speech output, capture/session purge on close, and save-to-Canvas are included. A first tap with no confirmed target captures nothing. |
| Task truth | Planned, ready, submitted-unverified, verified-complete, and returned states; reminder completion never proves submission; Classroom turned-in/returned evidence is distinct. |
| Action approval | Source-grounded action extraction produces inert suggestions; the user selects and approves them before assignments are added, and linked Reminders are a separate opt-in on that approval. |
| Study planning | Reviewable multi-day time-block drafts prioritize due work and weak mastery; approved blocks can be written to a selected writable Apple/Google calendar through EventKit, with portable `.ics` export and linked-event-only edits. |
| Connectors | Approved Reminder creation plus linked-completion reads; executable NotebookLM health/list/create/mirror/ask contracts; Classroom/Wispr safety contracts with live adapters still gated; Khan link/check-in flow. |

The supplied external PDF, media, RAG, routing, voice, and agent projects were reviewed separately. [The decision record](REFERENCE_REVIEW.md) distinguishes ideas adopted into The Desk's own interfaces from later experiments and runtime dependencies rejected for v1.

## Headless verification completed

- Full Swift 6 typecheck across the app and shared implementation.
- Native macOS executable linked successfully from all Swift sources.
- XcodeGen generated `TheDesk.xcodeproj` with Mac, universal mobile, and test targets; the shared icon catalog is included in both app resource phases, and the locked engine script and runtime manifest are bundled with the Mac target.
- Fifteen Python engine contract tests pass, including runtime-lock, bounded child output, cancellation escalation, disposable Codex workspace privacy, live-account response parsing, fake authenticated NotebookLM CLI boundaries, oversized-document rejection, archive-bomb rejection, and bounded many-slide extraction.
- The standalone core smoke executable passes scene and overlay validation, concurrent source deduplication and revision ordering, durable anchor reload, external revision-text migration/reload, persistence-failure lockout, corrupt-ID recovery, monotonic jobs, evidence, FTS citation, Canvas provenance, companion redaction, and read-only-policy checks.
- The XCTest suite is generated and mirrors the core safety contracts, but `swift test` cannot launch it on this host because the installed Command Line Tools have a `PackageDescription` manifest-linker mismatch. The standalone suite is compiled directly with Swift 6 instead; a full Xcode run remains required before signing.
- The latest Mac build was installed at `~/Applications/The Desk.app`, opened in the background without activation, and its populated Today workspace was captured and visually inspected. The Dock contains exactly one The Desk entry, between Notes and Calendar, pointing to that canonical install. The supplied icon was separately inspected at 1024 px after asset generation.

## External gates, not silently simulated

- A full Xcode installation, signing team, and the production CloudKit container are required to compile/install the iPhone and iPad target and prove real offline/device sync. The current host has Command Line Tools only, so no simulator or device claim is made.
- Classroom and Wispr currently have typed/read-only safety boundaries and manual import fallbacks, not live sync adapters. Live Classroom needs a Google OAuth client plus API implementation; live Wispr import needs the user's read-only MCP session plus adapter contract testing.
- Direct Google Calendar API OAuth is not part of this local-first release. A Google calendar already configured in macOS Calendar is available through EventKit; `.ics` export covers other Google Calendar setups.
- Live NotebookLM requires the guided install of the pinned `notebooklm-py` version into The Desk's isolated environment and personal Google authentication. The setup screen distinguishes missing runtime, missing package, authentication, service failure, and healthy states without blocking local learning.
- BYOK provider contracts require user-supplied keys; no credentials are committed or synced.
- The Codex app-server path is version-pinned and fail-closed. Existing ChatGPT sessions are detected automatically, while explicit device-code login remains attached through completion, cancellation, or timeout. A live end-to-end tutor answer is still unverified, and provider responses are currently buffered before UI token presentation rather than streamed upstream end to end.
- EventKit calendar and Reminder mutations require explicit user permission. Their ownership/idempotency boundaries are covered by local tests; no real calendar or reminder was mutated during this verification pass.
- Developer ID signing/notarization and TestFlight require Apple signing authority and a full Xcode/release environment.

The Clicky repository informed the user-initiated interaction pattern. The cursor-following streaming response overlay adapts its MIT-licensed non-activating panel pattern with the required notice retained in `THIRD_PARTY_NOTICES.md`; no Clicky assets, prompts, analytics, provider proxy, or vendor-specific service code are included.

The existing interface is a functional foundation rather than the accepted visual direction. The [Acely-inspired reskin plan](ACELY_RESKIN_PLAN.md) defines an original, bright, progress-first native design without copying Acely source or assets.

These gates do not block the local Mac study core, source ingestion, retrieval, saved canvases, planning, or cached companion viewing. Codex and optional connectors become available only when their matching runtimes, credentials, and permissions are present.
