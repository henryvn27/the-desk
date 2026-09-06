# AI routing

Deterministic capture and scheduling remain TypeScript. Normal inference uses a single OpenRouter chat/completions request from Electron main. Desk selects the model; the renderer cannot supply a tier, model, endpoint or credential. No direct provider integration or automatic retry/fallback is enabled.

| Tier | Approved model | Approved OpenRouter endpoint |
| --- | --- | --- |
| FAST | openai/gpt-5.6-luna | azure |
| STANDARD | openai/gpt-5.6-terra | azure |
| DEEP | openai/gpt-5.6-sol | azure |
| MULTIMODAL | google/gemini-3.8-flash | google-vertex/global |
| VERIFY | anthropic/claude-sonnet-5 | amazon-bedrock/global |

Text Lens uses STANDARD; explicit image input uses MULTIMODAL. The other tiers are registered, with workload escalation still unimplemented. Requested and returned model identities are checked against the small alias/canonical-ID registry in `packages/intelligence/routing.ts`. Unknown substitutions fail closed. These model IDs and provider ZDR listings were checked against the public catalog on 2026-09-06; availability remains external state.

Every request specifies `only`, `order`, `allow_fallbacks: false`, `require_parameters: true`, `data_collection: deny`, and `zdr: true`. No route silently relaxes privacy when unavailable. Provider retention constraints do not prove OpenRouter account-level input/output logging is disabled. Those account settings remain unverified.

Requests use strict JSON-schema output, bounded input/history/output, a 45-second timeout and cancellation. No model tool actions are enabled. Questions and active task excerpts are included on Ask. Captured images are included only after explicit sharing. History is bounded and discarded with the Lens window.

## Credentials

The development launcher explicitly enables main-process loading of the ignored repository `.env.local`. The value never passes through preload or renderer. Packaged apps ignore this development flag and package only explicit build outputs, not environment files. No developer key is bundled.

A packaged user can import their own OpenRouter key through an owned-main-window native file dialog. Main reads the file, validates it, and encrypts it with Electron safeStorage in `openrouter-key.enc`. No key-entry or key-value IPC exists in the renderer. Disconnect removes that encrypted file. Prior direct-provider credential files are ignored and preserved. Secure user-key import is local BYOK, not hosted production provisioning.

## Measurement and evidence

SQLite retains content-free model identity, feature/profile/session attribution, latency, success/failure, HTTP status, usage and OpenRouter-reported USD cost. Missing usage or cost remains null. The cost is provider-reported, not an independent invoice reconciliation. Prompts, screenshots, credentials and raw provider errors are not telemetry.

77 automated tests plus typecheck/lint/build pass. The synthetic Electron smoke covers native import, encrypted storage, no renderer key entry, request routing, restart and disconnect. Bounded live text and synthetic-image requests on 2026-09-06 both returned HTTP 401 authentication errors. No successful live answer, grounding, usage charge or provider privacy behavior has been proven. Stop retries until credential/account state changes. No personal screen or academic context was sent in these isolated checks.

Hard STEM escalation, quality/grounding acceptance, voice/media, fair-use limits, hosted provisioning, account logging confirmation and end-to-end billing reconciliation remain open. Canvas/PDF work remains paused.

Primary references:
- https://openrouter.ai/docs/guides/routing/provider-selection
- https://openrouter.ai/docs/guides/features/structured-outputs
- https://openrouter.ai/docs/cookbook/administration/usage-accounting
- https://openrouter.ai/docs/guides/privacy/data-collection
- https://openrouter.ai/docs/guides/features/input-output-logging


Lens now applies saved Guide me, Balanced (default), or Explain directly teaching instructions in the trusted main process. Explicit full-method requests remain allowed in every mode. Provider tool_calls/function_call payloads and extraneous output actions are rejected; no tools are offered. These are request and response boundaries, not proof that a model follows the pedagogy. Class-source retrieval and teaching-quality evaluation remain open; live OpenRouter authentication still returns HTTP 401 and was not retried.


Local Lens grounding now selects sources linked explicitly to the active task, then class-wide sources without other task links. It excludes unlinked/other-task material, preserves user-provided-text authority, and sends bounded excerpts with truncation and omitted-source counts. The serialized context is capped at 20,000 characters; no linked URL is fetched. Instructions distinguish source statements from supporting explanation and disclose conflicts. This is deterministic association-based context, not relevance retrieval, verified teacher authority, textbook/web search or validated citations.


Source priority now follows user-reported class-material, assigned-textbook, educational-reference, general-web, then unspecified; task association breaks ties. Context includes kindReportedBy=user and the unchanged ingestion authority. The user can correct source type in the Library. This implements reported source hierarchy, not independent verification of a teacher, publisher, page or claim. Relevance retrieval, citations and live source-fidelity evaluation remain open.


Grounding uses bounded lexical passage selection from the validated current question. Overlapping 3,000-character windows are scored by distinct non-stopword matches; repeated tokens do not increase score. Reported source hierarchy remains first, then lexical coverage, task association and stable ID. Excerpts retain exact UTF-16 offsets into original text, truncation, match count and explicit opening-fallback when nothing matches. This retrieves later passages without a network/index/model call. It is not semantic retrieval, proof of relevance, page-based citation or answer-fidelity verification.


Active-session Lens context now includes explicit global and current-class memory statements, bounded to 4,000 serialized characters within the existing overall context limit. It excludes other-class notes and discloses omitted count. Statements carry explicit origin and do not override current requests, source evidence or integrity boundaries. Forgetting excludes a note from subsequent assembled context; already-sent requests/conversation replies are not retroactively erased.


Learning controls apply to both Capture duration suggestions and inferred notes in active-session Lens context. Disabled learning retains notes for inspection/edit/forget but stops using inferred notes for tutoring. Explicit notes remain available. Confirmed duration patterns are tentative estimates based on recorded sessions, not proof of mastery or future outcomes. Clearing retains source session history but excludes it from new learning; re-enabling does not undo that exclusion.
