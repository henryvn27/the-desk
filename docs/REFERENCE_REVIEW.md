# The Desk reference repository review

Reviewed: 2026-08-30

The eight repositories are useful as design references, but none should become The Desk's foundation. The native, local-first architecture remains smaller, safer, and better aligned with a Mac execution host. No source code or assets from these repositories were copied into The Desk.

## Decisions

| Repository | Useful ideas | Decision for The Desk |
| --- | --- | --- |
| [PDFMathTranslate](https://github.com/PDFMathTranslate/PDFMathTranslate) | Page-aware layout regions, formula placeholders that survive translation, bilingual output, cache keys, and cancellable progress-aware jobs. | **Reimplement the patterns.** Do not vendor the AGPL-3.0 Python/ONNX stack into v1. Consider an optional isolated translation helper only after license, model/font, offline-packaging, and Apple Silicon reviews. |
| [knowsuchagency/pdf-to-podcast](https://github.com/knowsuchagency/pdf-to-podcast) | A typed dialogue schema and the staged `extract → script → synthesize → assemble` pipeline. | **Use the artifact shape, not the backend.** A future Study Audio artifact should keep page citations, review its script before synthesis, use bounded per-segment generation, and default to local Apple speech. Reject its whole-document cloud flow and prompt behavior that can fill factual gaps. |
| [NVIDIA PDF to Podcast](https://github.com/NVIDIA-AI-Blueprints/pdf-to-podcast) | Separating a target PDF from supporting context, a guide prompt, durable intermediate artifacts, and a multi-stage generation job. | **Reference for Study Audio later.** Do not adopt its NIM/Docling/Redis/MinIO/ElevenLabs deployment stack for a Mac-first personal app. The Desk's own source revisions and AI harness should supply these boundaries. |
| [NVIDIA Video Search and Summarization](https://github.com/NVIDIA-AI-Blueprints/video-search-and-summarization) | Transcript plus sampled-frame retrieval, timestamped findings, searchable video archives, and multimodal query decomposition. | **Use for a later lecture-video source type.** Build it natively with AVFoundation, Vision, Apple transcription, and timestamp anchors. Reject the GPU/NIM/Kubernetes-style runtime for v1. |
| [NVIDIA LLM Router](https://github.com/NVIDIA-AI-Blueprints/llm-router) | Provider registry, named routing policies, manual override, streaming passthrough, and latency/error/usage telemetry. | **Do not depend on it.** The project is deprecated in favor of NeMo Switchyard and assumes NVIDIA infrastructure. Keep The Desk's routing decision separate from execution and record the reason, health, cost policy, provider, and actual model for every run. |
| [NVIDIA RAG](https://github.com/NVIDIA-AI-Blueprints/rag) | A retrieval-only API boundary, collection filters, dense+sparse retrieval, reranking, context expansion, and richer citation metadata. | **Adopt the contracts incrementally.** Continue with local FTS5 and Apple embeddings, then add optional reranking and multimodal citations behind The Desk's index interface. Do not ship the GPU/NIM/vector-database stack or cloud-dependent "Lite" mode as local Mac RAG. |
| [NVIDIA Nemotron Voice Agent](https://github.com/NVIDIA-AI-Blueprints/nemotron-voice-agent) | Voice activity detection, end-of-utterance detection, interruption handling, and a staged ASR → LLM → TTS voice loop. | **Borrow interaction concepts later.** Keep explicit push-to-talk as the privacy baseline. An opt-in conversational mode may add visible listening, interruption, and local-first speech adapters; the NVIDIA runtime's GPU and hosted-service requirements do not fit v1. |
| [NVIDIA Goose mirror](https://github.com/NVIDIA-AI-Blueprints/goose) / [canonical AAIF Goose](https://github.com/aaif-goose/goose) | Provider-neutral model configuration, explicit per-tool permission modes, MCP-style extension boundaries, process hardening, and bounded agent turns. | **Use only the harness lessons.** The NVIDIA repository has moved to AAIF and should not be the adoption target. Do not embed a general autonomous agent or allow screen/assignment automation. The Desk's typed study tasks and connector allowlists remain narrower: no clicking, typing, submitting, arbitrary extensions, or arbitrary CloudKit commands. |

## What changes the roadmap

### Keep in the current foundation

- Typed, resumable jobs with progress and cancellation boundaries.
- Provider registration, explicit manual override, visible model identity, and recorded routing reasons.
- Retrieval separated from generation so local citations remain canonical across providers.
- Staged, reviewable artifacts instead of one-shot opaque outputs.
- Page, region, and timestamp anchors as first-class data—not filenames embedded in prose.

### Add after the core is proven

1. **Study Audio:** turn selected cited passages into a short reviewable briefing. Store the script, voice segments, source anchors, and audio as one versioned artifact. Default to `AVSpeechSynthesizer`; cloud voices are explicit BYOK overrides.
2. **Lecture Video:** import a video, extract a timestamped transcript, sample frames around topic boundaries, run Vision OCR, and let search return time-linked transcript and frame citations.
3. **Hybrid retrieval:** combine FTS5 with local embeddings, add an optional reranker, and preserve stable source/revision/anchor identifiers through retrieval and generation.
4. **Scientific translation:** add a derivative source revision with side-by-side original/translation views and protected equation regions. Keep it optional until the AGPL and model/font packaging questions are resolved.
5. **Conversational voice:** add opt-in VAD, end-of-utterance, and barge-in only after the current explicit-capture Study Buddy has privacy and accessibility evidence.

## Boundaries that do not change

- The Mac remains the only AI execution host.
- Originals, canonical revisions, citations, and saved artifacts remain owned by The Desk.
- Only retrieved passages are sent to a provider; whole textbooks do not leave the Mac by default.
- A model may propose a route, study action, calendar block, visual scene, or overlay cue, but validated app code decides what can be stored or rendered.
- Assignments are never submitted by an AI agent. Calendar and reminder completion are not submission proof.
- Direct code reuse requires a repository-specific provenance and license review, including dependencies, models, containers, sample data, fonts, and media—not just the top-level code license.
