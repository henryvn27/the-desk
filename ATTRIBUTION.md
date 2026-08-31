# Attribution

The Desk is original software released under the [MIT License](LICENSE). The app icon was supplied for The Desk by Henry Van Ness and is released with the rest of the project under the same license. Its source record and shipped-file hashes are retained in [docs/ARTWORK_PROVENANCE.md](docs/ARTWORK_PROVENANCE.md).

## Optional runtime

[notebooklm-py](https://github.com/teng-lin/notebooklm-py) is an optional, unofficial NotebookLM connector. It is not vendored in this repository and is installed only through an explicit user action into The Desk's managed environment.

- License: MIT
- Copyright: Copyright (c) 2026 Teng Lin
- Relationship: optional runtime dependency

NotebookLM is a Google product. The Desk and notebooklm-py are not affiliated with or endorsed by Google, and the undocumented service can change without notice.

## Product and interaction references

These products informed specific interaction ideas. The Desk does not include their code, logos, screenshots, copy, or other assets.

- [Clicky](https://github.com/farzaa/clicky), by Farza — MIT. Its user-invoked, cursor-adjacent tutor pattern informed Study Buddy. The streaming response overlay is adapted from Clicky's non-activating panel pattern at commit `a80fa80721a8aebe51a170a7780705024ebc6e46`; the retained copyright and MIT notice are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). No Clicky assets, provider proxy, analytics, prompts, or sample data are included.
- [OpenAI Visualizations](https://learn.chatgpt.com/docs/visualizations) — product reference for generated interactive explanations. Study Canvas uses The Desk's own versioned native scene schema and renderer.
- [Acely](https://acely.com/ai-sat-tutor) — visual and product reference for clear daily priorities, progress beside practice, and an encouraging study experience. The planned reskin is original and uses no Acely assets or code.

## Repository research references

The following repositories were reviewed for architecture and workflow ideas. No source code, model weights, sample data, containers, or media from them are included in The Desk.

| Project | License reported by its repository | How it informed The Desk |
|---|---|---|
| [PDFMathTranslate](https://github.com/PDFMathTranslate/PDFMathTranslate) | AGPL-3.0 | Layout-aware mathematical PDF processing research only |
| [pdf-to-podcast](https://github.com/knowsuchagency/pdf-to-podcast) | Apache-2.0 | Simple document-to-dialogue workflow research only |
| [NVIDIA PDF to Podcast](https://github.com/NVIDIA-AI-Blueprints/pdf-to-podcast) | Apache-2.0 for repository source; model and service terms are separate | Staged outline, dialogue, provenance, and retry ideas only |
| [NVIDIA Video Search and Summarization](https://github.com/NVIDIA-AI-Blueprints/video-search-and-summarization) | Mixed; see its repository and component notices | Timestamped evidence and bounded media sampling ideas only |
| [NVIDIA LLM Router](https://github.com/NVIDIA-AI-Blueprints/llm-router) | Apache-2.0 | Capability-aware provider-routing research only |
| [NVIDIA RAG](https://github.com/NVIDIA-AI-Blueprints/rag) | Apache-2.0 | Retrieval and citation architecture research only |
| [NVIDIA Nemotron Voice Agent](https://github.com/NVIDIA-AI-Blueprints/nemotron-voice-agent) | BSD-2-Clause | Voice-turn and interruption research only |
| [NVIDIA Goose](https://github.com/NVIDIA-AI-Blueprints/goose) | Apache-2.0 | Typed tool and local-agent orchestration research only |

The NVIDIA repositories can include separately licensed models, containers, services, sample data, codecs, and deployment dependencies. Their repository-level license does not relicense those components. The Desk deliberately does not bundle them.

## Platform services and trademarks

The Desk uses Apple system frameworks such as SwiftUI, PDFKit, Vision, Speech, ScreenCaptureKit, EventKit, CloudKit, and Security through the platform SDK. Apple, ChatGPT, Codex, OpenAI, Anthropic, Gemini, Google, Google Classroom, NotebookLM, Wispr Flow, Khan Academy, and all other product names are trademarks of their respective owners. Their names are used only to identify compatible integrations.
