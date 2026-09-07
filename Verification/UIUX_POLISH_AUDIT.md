# Desk UI/UX polish audit

Date: 2026-09-07

This is the baseline for the post-V1 product-polish pass. It describes the shipped Electron UI before changes in this work item; it is not a new product architecture.

## Highest-impact friction

| Journey | Current path | Friction | Priority |
| --- | --- | --- | --- |
| Start the day | Launch → scan a long model-oriented sidebar → read Home → open a task | The primary decision is visually buried under 14 equal navigation destinations and a large empty card. | P0 |
| Capture | Shortcut → large modal → choose paste/manual/import → save → land in Inbox | The acknowledgement is clear, but the modal has no visible close affordance and the user is moved to a separate destination for a small follow-up. | P1 |
| Assignment work | Library → find task → open editor → open resource / Notes / Study | Useful actions are split across a dense row of buttons; class context is easy to lose. | P1 |
| Study session | Home → start → compact controller | The controller is intentionally separate, but its presence is not explained until after the session starts. | P1 |
| Class | Sidebar → Class → scan hero, Next, progression, learning, grades, sources | The content is good, but equal raised panels make the student loop read like a dashboard rather than a sequence. | P1 |
| Lens | Invoke → centered panel covers screen → choose mode → draw selection → ask | Selection is the natural first action, but the blocking panel currently becomes the visual target and hides the work. | P0 |
| Find material | Cmd/Ctrl+K → Library → search | The shortcut works, but there is no visible global affordance or indication of the destination. | P1 |

## Baseline qualitative counts

- Home to start the recommended work: 1 navigation action plus 1 start action; no unnecessary confirmation, but the user must parse a large card and a long sidebar first.
- Quick capture to durable save: 2–3 actions after the shortcut; 1 modal transition; classification remains asynchronous as intended.
- Lens to first selection: 1 invocation plus a mode decision before drawing; the panel occupies the center of the selection surface.
- Advanced academic views: 1 click from the sidebar, but the cost is persistent navigation density and visible database concepts.

## Baseline visual findings

- The warm paper palette and serif display type are distinctive and worth preserving.
- Nearly every major surface is a raised rounded card, so hierarchy collapses into repeated containers.
- Home and Class use oversized display headings where a compact desktop work surface would be faster to scan.
- The sidebar has no grouping between student destinations and internal academic support views.
- Lens is visually polished in isolation but wrong for its task because its panel blocks the selected content.
- The app menu still identifies the development build as Electron, and packaging has no explicit Desk icon resource.

## Scope for this pass

1. Make Lens selection-first with a lightweight contextual popover while keeping existing grounding, tutoring, and save actions.
2. Group navigation without deleting deep access to V1 screens.
3. Add a visible search affordance and clearer active/context states.
4. Tighten Home/Class surfaces and dialog affordances without changing planner or domain behavior.
5. Add a real packaged icon and replace Electron placeholder menu identity.
6. Verify the changed flows in the packaged and installed app at multiple desktop sizes.

## Result

The pass keeps the V1 visual language and domain surface, while removing the highest-cost interaction friction:

- Home and class navigation now separate daily destinations from Study and Academic details. All existing deep links remain available.
- The header exposes Library search and the current class/page context without adding another dashboard surface.
- Capture has an explicit, keyboard-accessible close path and keeps the existing immediate-save/inbox behavior.
- Lens is selection-first: the underlying screen remains the interaction surface, a compact contextual panel sits at the lower edge, and the panel only expands when attached context or advanced screen capture is needed.
- The native macOS menu is branded with the Desk product identity (`The Desk V1`, replacing the Electron placeholder), the packaged bundle has a generated Desk icon, and secondary windows carry Desk titles.

The implementation deliberately leaves the store, planner, capture pipeline, Lens provider boundary, Notes/Canvas model, and academic routes intact. The only behavioral additions are presentation state and navigation affordances.

Verification evidence:

- `npm run check` — Electron-only guard, TypeScript, lint, 238 unit tests, 10 extension tests, and production build all pass.
- `node scripts/smoke-desktop.mjs` — Home, assignment capture, Study Session, Lens selection/ask/dismiss, completion, restart, capture review, Plan, and Library persistence pass.
- Lens action, tutoring, grounding, retrieval, and source-priority smokes pass.
- `npm run package` produces a signed arm64 bundle with `Contents/Resources/icon.icns`.
- The installed bundle at `/Users/henry/Applications/The Desk V1.app` opens with the `The Desk V1` app menu, the revised Home and Capture surfaces, and the same desktop smoke passes with `DESK_EXECUTABLE` set.
- A packaged 820×620 viewport has no horizontal overflow and keeps the primary navigation and Capture/Search actions visible.

The packaged smoke still reports its existing limitation that AI, voice, and captured-screen interpretation are outside the deterministic fixture. Lens visual inspection is therefore backed by the installed UI screenshot and the deterministic selection-state assertions, while provider quality remains covered by the existing intelligence tests.
