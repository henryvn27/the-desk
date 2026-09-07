# Chat-first desktop architecture

The desktop renderer opens on Chat, but Chat is a projection over the existing Desk graph rather than a second academic system. The left rail keeps Today, Plan, Notes, Library, Capture, Settings and class context reachable; the conversation is the default decision surface, while each dedicated workspace remains authoritative for its own work.

`packages/intelligence/chat.ts` resolves a small set of high-frequency requests deterministically from `Snapshot`, Planner/Home and Student Model projections. It can show next work, exact continuation, upcoming deadlines, material attention, bounded available-time plans and open existing workspaces. Action buttons map to existing typed `session.start`, Notes, Capture or navigation paths. When the provider is connected, the same local projection is sent as bounded read-only grounding so Luna writes the conversational explanation; if the provider is unavailable, the local result remains usable. An unresolved request never mutates state implicitly.

Chat explanations use the existing trusted main-process OpenRouter/Luna transport through a new `desk:chat` IPC method. The main process assembles a bounded, read-only context from canonical projections, relevant source evidence and optional browser context; the renderer receives only the response text, model identity and the locally-derived safe artifact/action. Provider actions are rejected by the existing Lens contract, and provider failure leaves deterministic planning available.

Chat threads are transient renderer-session projections for now. They do not become a second SQLite truth store: new conversations reset context, while Classes, Tasks, Assessments, Notes, Sources, StudySessions, Planner state, provenance and Student Model evidence remain durable and canonical. A future durable thread history should persist only conversation metadata and references, never copied academic facts.

The chat-first shell intentionally avoids a dashboard replacement. Rich response artifacts are compact conversational projections, and dedicated workspaces remain the place for editing notes, reading sources, planning, studying and capture review.
