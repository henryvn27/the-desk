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
