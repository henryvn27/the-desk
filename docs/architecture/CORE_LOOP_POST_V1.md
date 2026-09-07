# Core loop integration after V1

The Desk's academic loop remains local-first and deterministic:

`Capture → Understand → Plan → Work → Observe → Learn → Adapt`

This slice adds the smallest shared decision boundary needed to keep the loop
coherent. `packages/planner/next-action.ts` derives a read-only `NextAction`
from the canonical `Snapshot`. It first respects an active `StudySession`,
then the existing Planner's earliest executable block, then actionable Home
attention, then a Student Model learning objective, and finally durable
Capture. It never writes state, creates a second priority score, or asks an AI
model to choose work.

Each action carries:

- a stable kind and target IDs for Home, Plan and Class navigation;
- an urgency and estimated duration when the Planner has one;
- deterministic evidence and a short reason for the recommendation;
- a bounded action label (`Start`, `Open study controller`, `Review` or
  `Capture`);
- a confidence value describing the decision boundary, not a claim about
  mastery.

`DeskIntelligence.nextAction` now returns this same projection. Home uses it
for the Next card and its “Why Desk thinks this” disclosure, while the Class
workspace reuses the same reason/evidence when its task is the shared next
action. If the intelligence IPC is temporarily unavailable, Home continues to
use its existing `deriveHome` Planner projection.

The existing store remains the orchestration boundary for consequences:

- accepted or auto-filed captures create canonical Tasks and reserve work
  through the existing Planner transaction;
- session end records actual duration, checklist state, completion report and
  the deterministic session summary;
- checked attempts recorded during review update canonical Concept counters and
  Student Model evidence;
- Home and the shared Next Action are recomputed from the resulting SQLite
  snapshot rather than from renderer-local assumptions.

This is intentionally additive. Notes/Canvas, Sources, Capture Inbox, Lens,
Supabase outbox and the academic graph remain their existing owners. A future
orchestration event log would only be justified if a measured cross-process
need appears; this projection does not introduce one.

## Verification

`packages/planner/next-action.test.ts` covers planner work, active-session
precedence, deadline decisions, evidence-backed review objectives and empty
capture fallback. `packages/intelligence/desk-intelligence.test.ts` verifies
that the main-process intelligence projection exposes the same executable
target, duration, action and evidence. Typecheck and ESLint run over the
renderer and the shared packages.
