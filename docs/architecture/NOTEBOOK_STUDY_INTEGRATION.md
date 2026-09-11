# Notebook-powered study integration

## Planning boundary

The Desk remains the canonical owner of classes, assessments, Sources, Notes,
StudySession state, Attempts, Mistakes, and Student Model evidence. NotebookLM
is an optional generation engine behind a main-process adapter. No renderer
feature talks to NotebookLM directly and no NotebookLM notebook/source
management is exposed as a product concept.

The current `notebooklm-py` surface is asynchronous for source ingestion and
artifact generation. Its Python client exposes notebook/source/artifact APIs,
structured quiz and flashcard downloads, audio/video downloads, and polling.
The project also ships an experimental loopback REST server. Authentication is
consumer Google storage/cookie state; it is unofficial and must remain an
explicit experimental integration. The REST server requires a local bearer
token and loopback binding, which makes it a cleaner future boundary than
shelling out with user input.

## Repository findings

- `StudySession` already owns persisted study activity state and learning-loop
  evidence. Generated quiz interactions should become session Attempts rather
  than a second history system.
- `Source` and Canvas-backed Notes are canonical and already carry provenance;
  material sets should reference their IDs and store only a content fingerprint.
- `SessionKit` already resolves task-linked and class-wide material and Student
  Model context. The first material resolver extends this projection rather than
  adding a retrieval database.
- The integration catalog already names Gemini Notebook / NotebookLM as
  experimental and unavailable. It remains a capability/status surface, not a
  navigation item.
- The Electron main process is the trusted IPC boundary. The renderer receives
  sanitized status and generated study records only.

## Chosen implementation shape

1. Add validated `StudyMaterialSet` and `StudyArtifact` records to the local
   SQLite domain store. They reference existing Source/Canvas IDs and retain
   artifact-level provenance, source fingerprint, lifecycle state, and cached
   payload/media metadata.
2. Add a deterministic material resolver for assessment, task, class, explicit
   Source IDs, and Note IDs. It deduplicates and ranks existing relationships;
   it never uploads the whole Library.
3. Add the Desk-owned `NotebookStudyEngine` interface with a deterministic fake
   engine for tests and a loopback REST adapter seam for the optional
   notebooklm-py server. The fake is the default in tests; the external adapter
   is disabled unless explicitly configured in the trusted main process.
4. Add native Desk Quiz and Flashcards activities first. Quiz answers create
   canonical Attempts through the existing session evidence path; uncertain
   concept mappings remain unassigned. Flashcard self-report is recorded as
   light evidence only. Audio/video use the same artifact lifecycle and a
   native media surface when a cached file is available.
5. Add contextual entry points from Chat, class assessment material, and
   selected Sources. The four modes remain contextual actions, not global
   navigation.
6. Keep generation asynchronous and recoverable. Existing Desk functionality
   remains usable when NotebookLM is disconnected, unavailable, or offline.

## Verification plan

- Domain tests: migration, material-set deduplication/fingerprints, artifact
  lifecycle, validation, playback persistence, and quiz-to-Attempt behavior.
- Adapter tests: fake generation, malformed payloads, auth expiry, rate limits,
  timeout, and unavailable engine.
- Renderer smoke: contextual generation, native quiz/flashcard interaction,
  restart persistence, and cached media state.
- Packaging checks: no Google cookies/tokens or NotebookLM credentials in the
  renderer or packaged output. Live NotebookLM generation remains a bounded
  external test after an explicit account connection; it is not required for
  ordinary Desk use.

## Implemented boundary

The first production slice is now implemented behind the existing Desk main
process and IPC boundary. `StudyMaterialSet` references canonical Source and
Canvas-backed Note IDs, computes a content fingerprint, and persists the
external notebook/source mapping without copying material into a second Desk
database. `StudyArtifact` stores the native Quiz, Flashcards, Audio, or Video
payload, status, provenance fingerprint, generation options, and local cache
metadata. Both records are local-first SQLite state and are intentionally
excluded from the cloud outbox until the artifact sync contract is defined.

Chat requests, class assessments, and selected Library Sources can start the
same native Desk activity. Quiz answers write existing Attempt evidence when a
class is known; flashcard self-report remains explicitly weak evidence. Audio
and Video are rendered by native Desk media controls, resume from the persisted
playback position, and are served through the `desk://study-media` protocol so
renderer code never opens Finder or an external player. A first external
generation asks for concise consent before selected Sources or Notes are sent
to the connected Google Notebook account.

When an assessment action carries an existing task, generation also starts the
canonical StudySession after the artifact is queued (or reuses an active
session). The artifact remains the native activity surface while the existing
compact controller and session history remain authoritative for timing and
completion.

The deterministic fake engine is used by domain and Electron smoke tests. The
optional loopback REST adapter is only enabled when the trusted main process is
given `DESK_NOTEBOOKLM_URL` and `DESK_NOTEBOOKLM_SERVER_TOKEN`; it is never
initialized from renderer input and is unavailable by default. Its async
generation path persists `generating`, polls with bounded backoff, validates
structured exports, and caches downloaded media. If that experimental adapter
is unavailable, normal Chat, Notes, Sources, Planner, and StudySession flows
remain local and usable.

The adapter bounds every request and response. Structured exports are capped
before parsing, media downloads are capped before writing, and cached media
filenames are derived from a hash of the external artifact ID rather than
provider-controlled path text. Quiz answers and Flashcard reviews are checked
against the generated activity before persistence. When the same canonical
Source/Note selection changes, the Desk keeps the existing external notebook
mapping and refreshes only changed material; in-flight artifacts are marked
stale when their fingerprint changes. On restart, persisted generating
artifacts are rehydrated through the adapter's poll boundary when available,
or fail clearly for an engine that cannot resume them.

## Verification performed

- `packages/study/*` unit coverage validates material references, deterministic
  Quiz/Flashcards/Audio/Video output, payload validation, and loopback URL
  restrictions.
- `packages/domain/notebook-study.test.ts` validates schema-44 migration,
  local persistence, optimistic revision checks, and restart recovery.
- `scripts/smoke-study-artifacts.mjs` launches an isolated Electron profile,
  creates a class and Source, generates all four modes, invokes Quiz and
  Flashcards through Chat, checks a quiz answer creates an Attempt, and saves a
  rendered native activity screenshot.
- `scripts/smoke-packaged-study.mjs` repeats the material generation, Chat →
  Quiz, Attempt persistence, and rendered activity checks against the packaged
  macOS executable with isolated data.
- The domain restart test also covers durable media playback position, so a
  cached Audio or Video artifact can resume without an external player.
- TypeScript, production build, lint, and the existing full test suite remain
  required before packaging. Live NotebookLM generation and Google account
  authentication remain an explicit external/manual boundary because the
  upstream consumer API is unofficial.

## Known external boundary

The REST server and consumer authentication supplied by `notebooklm-py` are
experimental and account/session dependent. The packaged Desk does not bundle
Python, a sidecar, Google cookies, or a reusable NotebookLM credential. A
future installer can add a signed, pinned helper only after its lifecycle,
authentication, and release-security contract is separately verified. Until
then, the adapter is a safe opt-in integration for a locally managed loopback
server; the fake engine is the reproducible path for local verification.
