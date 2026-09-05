# AI routing

Deterministic capture and scheduling run in TypeScript without an LLM. The first Lens adapter uses OpenAI Responses with a fixed `gpt-5.4-mini` model, bounded input/output, strict structured output, a 45-second timeout, cancellation, and no automatic retry. No third-party tool actions are enabled.

The key is entered in Settings, encrypted through Electron safeStorage, and never returned to renderers after storage. The main process alone sends provider requests. User questions and active task excerpts are included on Ask. A captured image is included only after the explicit share checkbox. Follow-up context is bounded and discarded with the Lens window.

Every attempted provider request reports actual available usage, cached tokens, latency, success/failure and a dated estimated USD amount. SQLite schema 2 stores feature, local profile, session id and content-free telemetry. Missing usage remains null, never zero cost. The recorded price is an estimate based on the published rate, not proof of invoiced spend.

Live credential-based provider, image grounding, teaching quality and end-to-end cost reconciliation are still unverified. Hard STEM escalation, other providers, voice/media routing, hosted consumer provisioning and fair-use enforcement remain open.

Sources checked 2026-09-05:
- https://developers.openai.com/api/docs/models/gpt-5.4-mini
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/guides/images-vision
