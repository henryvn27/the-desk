# The Desk

The Desk is a native, local-first study workspace for macOS, iPhone, and iPad. It organizes classes and long-term tracks around one loop: capture material, process it on the Mac, study from cited sources, save interactive canvases, and turn weak areas or assignments into honest next actions.

## What is implemented

- Native SwiftUI layouts for Mac, iPhone, and iPad, with AP Physics C, AP Statistics, college essay, and SAT fixtures.
- PDF, EPUB, DOCX, PPTX, RTF, Markdown, text, image, audio, URL, and Wispr-transcript ingestion boundaries.
- Original-file preservation, SHA-256 deduplication, immutable revisions, resumable PDF extraction, Vision OCR, Speech transcription, timestamp/page anchors, and SQLite FTS5 retrieval.
- A Mac-only AI harness with Codex app-server as the default plus Keychain-backed OpenAI, Anthropic, and Gemini adapters. Manual provider selection never silently falls back.
- Versioned and validated Study Canvas scenes, citations, accessibility summaries, practice modes, stale-source detection, review diffs, and revision history.
- A Mac-only Study Buddy that brings Clicky's cursor-adjacent teaching interaction inside The Desk: after one explicit target confirmation, hold Option-Space to talk and release for one ScreenCaptureKit snapshot; the grounded answer streams beside the cursor without activating The Desk. Vision OCR, validated overlay cues, optional spoken answers, capture purging, and save-to-Canvas are included.
- Durable offline companion capture outbox, private CloudKit processing queue, and a privacy-filtered library mirror for offline iPhone/iPad viewing.
- User-approved linked Reminder creation and linked-completion reads, explicit assignment evidence states, read-only Classroom/Wispr safety boundaries, Khan links with check-ins, and optional NotebookLM mirroring/query commands.
- Review-first action extraction from notes or Wispr transcripts; suggestions cannot create assignments or linked Reminders until the user explicitly approves them.
- A review-first Study Plan that time-blocks due work and weak topics, then writes only approved blocks to a selected Apple or Google calendar configured on the Mac; `.ics` export supports other calendar setups.

See [implementation status](docs/IMPLEMENTATION_STATUS.md) for the verified boundary and credential-gated integrations. The supplied PDF, media, RAG, routing, voice, and agent repositories are assessed in [reference repository review](docs/REFERENCE_REVIEW.md). The current functional shell is scheduled for an original [Acely-inspired reskin](docs/ACELY_RESKIN_PLAN.md) focused on clear daily priorities and visible study progress.

## Generate and run the Apple project

Requirements: a full Xcode installation, XcodeGen, and the Python version pinned in `Engine/runtime-lock.json`. The app bundles The Desk's Python bridge, not Codex itself. Its default AI provider requires the exact external Codex runtime shipped inside `/Applications/ChatGPT.app`; The Desk validates that absolute path, version, and app-server protocol and fails closed when it is missing or incompatible. Neither Python nor Codex is resolved from an arbitrary executable on `PATH`.

```bash
cp Config/Local.xcconfig.example Config/Local.xcconfig
# Edit Config/Local.xcconfig with identifiers registered to your Apple team.
xcodegen generate
```

Open `TheDesk.xcodeproj`, select `TheDeskMac` or `TheDeskMobile`, then configure:

1. Your Apple development team.
2. The bundle, Keychain, and private CloudKit identifiers in the ignored `Config/Local.xcconfig`. `Config/Shared.xcconfig` contains neutral public defaults; forks must use identifiers registered to their own Apple team.
3. The required iCloud, Reminders, microphone, camera, speech-recognition, and screen-recording capabilities for the chosen target.

Provider keys are entered inside The Desk and stored in the Mac Keychain. They never enter CloudKit or the companion app.

The macOS package target can also run with a complete Swift toolchain:

```bash
swift run TheDesk
```

## Test

```bash
swift test
python3 -m unittest discover -s Engine/tests -v
```

`Verification/CoreSmoke.swift` is a toolchain-independent executable smoke suite for scene validation, overlay bounds, source deduplication, concurrent revision ordering, durable page/time anchors, persistence recovery, assignment evidence, Canvas revision history, companion redaction, and connector safety policies.

## Optional engines and connectors

- **NotebookLM:** use the guided setup in Integrations to install the version pinned in `Engine/runtime-lock.json` into The Desk's isolated Mac environment, then authenticate it. Installation and browser sign-in are always explicit user actions. The Desk checks auth, lists or creates class notebooks, mirrors selected original sources, and asks source-filtered questions through JSON CLI contracts. NotebookLM remains disposable and non-canonical.
- **Google Classroom:** the app declares only three read-only scopes and has no submit, turn-in, unsubmit, or mutation method. The live OAuth/API adapter still needs a Google client and consent before course data can sync.
- **Wispr Flow:** the safety contract is read-only and manual transcript/file import works now. A live Wispr MCP session adapter still needs to be configured and contract-tested.
- **Apple Reminders:** grant EventKit access when approving an action or creating a linked reminder. The Desk creates only user-approved reminders and reads completion only through the identifier it stored; completion is never submission proof.
- **Apple and Google Calendar:** build and approve a Study Plan, then choose any writable Apple or Google calendar configured in macOS Calendar. The Desk creates only approved blocks and updates only stored linked event identifiers; `.ics` export supports other setups without a direct account connection.
- **Khan Academy:** store lesson/course links and record score, confidence, and next step after returning; no scraping or answer automation.

External connectors fail independently. Local sources, Codex, saved canvases, and companion cache remain usable when an optional service is unavailable.

## Repository layout

- `Sources/LearningHomeKit`: shared domain, persistence, CloudKit, ingestion, AI, connector, Canvas, Study Buddy, and adaptive UI implementation.
- `Sources/LearningHome`: internal cross-platform app entry point.
- `Engine`: Python bridge for Codex app-server, document extraction, and optional `notebooklm-py`.
- `Tests` and `Verification`: XCTest contracts and a standalone native smoke harness.
- `project.yml`: reproducible Mac/iOS/iPad Xcode project definition.

## Privacy, security, and license

The intended data boundary is documented in [PRIVACY.md](PRIVACY.md), and vulnerability reporting is covered by [SECURITY.md](SECURITY.md). The Desk is released under the [MIT License](LICENSE). Optional runtimes, product references, repository research, trademarks, and project-artwork provenance are documented in [ATTRIBUTION.md](ATTRIBUTION.md); retained notices for adapted third-party code are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
