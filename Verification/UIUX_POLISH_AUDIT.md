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

1. Make Lens selection-first with no pre-selection panel while keeping existing grounding, tutoring, and save actions.
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
- Lens is selection-first: invocation exposes the underlying screen for drawing immediately, and only the post-request answer uses a compact contextual surface.
- The native macOS menu is branded with the Desk product identity (`The Desk V1`, replacing the Electron placeholder), the packaged bundle has a generated Desk icon, and secondary windows carry Desk titles.

The implementation deliberately leaves the store, planner, capture pipeline, Lens provider boundary, Notes/Canvas model, and academic routes intact. The only behavioral additions are presentation state and navigation affordances.

Verification evidence:

- `npm run check` — Electron-only guard, TypeScript, lint, 247 unit tests, 10 extension tests, and production build all pass.
- `node scripts/smoke-desktop.mjs` — Home, assignment capture, Study Session, Lens selection/ask/dismiss, completion, restart, capture review, Plan, and Library persistence pass.
- Lens action, tutoring, grounding, retrieval, and source-priority smokes pass.
- `npm run package` produces a signed arm64 bundle with `Contents/Resources/icon.icns`.
- The installed bundle at `/Users/henry/Applications/The Desk V1.app` opens with the `The Desk V1` app menu, the revised Home and Capture surfaces, and the same desktop smoke passes with `DESK_EXECUTABLE` set.
- A packaged 820×620 viewport has no horizontal overflow and keeps the primary navigation and Capture/Search actions visible.

The packaged smoke still reports its existing limitation that AI, voice, and captured-screen interpretation are outside the deterministic fixture. Lens visual inspection is therefore backed by the installed UI screenshot and the deterministic selection-state assertions, while provider quality remains covered by the existing intelligence tests.

## Shared-system refinement · 2026-09-07

The follow-up pass stayed inside the shipped shell and projection architecture. It made the semantic tokens explicit in OKLCH, removed decorative page/header treatment, replaced repeated accent stripes with tonal selection and neutral evidence callouts, and added the platform reduced-transparency fallback. Chat suggestions now read as compact actions instead of pills. Long rows/messages use `content-visibility`, Home/Chat projections are memoized, and refresh polling is bounded without changing the one-second study clock.

One small workflow correction came out of the exact-executable smoke: when the compact controller ends a session while the main window is on Chat, the main renderer now returns to Home as soon as the shared snapshot exposes the canonical session review. The smoke selector was also scoped to the header/sidebar duplicate Capture actions so the verification path matches the shipped shell.

Verification for this refinement:

- `npm run check` — Electron-only guard, TypeScript, lint, 277 domain tests, 10 extension tests, and production build all pass.
- `npm run test:release-boundaries` — build inventory, secret scan, package archive, and bounded provider failure handling pass.
- `DESK_EXECUTABLE=/Users/henry/Applications/The Desk V1.app/Contents/MacOS/The Desk V1 node scripts/smoke-desktop.mjs` — exact installed executable passes the complete desktop flow, including session review after controller completion and restart persistence.
- `npm run package` — signed arm64 directory bundle completes; notarization is skipped because no notarization options are configured.
- Installed bundle `/Users/henry/Applications/The Desk V1.app` matches the release `app.asar` SHA-256 (`68f72434377600fffa19583210fc792ff06e697ea01d5aea94385641452b9336`), passes `codesign --verify --deep --strict`, and remains the Dock target.
- Foreground CUA inspection of the installed build shows the revised Chat surface, live OpenRouter Luna response, and Home selection state. An isolated packaged class fixture confirms the neutral “What’s next” callout and preserves the current-unit indicator.

No Swift files, parallel domain model, provider integration, or Canvas/Lens business logic was introduced by this pass. The requested `slop.md` guidance was intentionally not applied.

## Lens follow-up: transparent-window compositing

The follow-up screenshot exposed a concrete rendering defect in the shipped Lens window: its transparent BrowserWindow combined a translucent, blurred panel with the large shared shadow, producing a multicolor contour around the panel on desktop backgrounds. The provider failure message was also rendered as unstyled body text beneath the action row.

The smallest fix was presentation-only. Lens stage and panel surfaces are now opaque and border-led with no blur or shadow, which removes the transparent-window compositing halo without changing selection, grounding, provider, or save behavior. Provider/status text uses a compact accessible banner with `role="status"` and `aria-live="polite"`.

Follow-up visual evidence:

- `artifacts/lens-flat-surface.png` — waiting state with a flat panel and no colored contour.
- `artifacts/lens-provider-error.png` — provider error presented as a compact status banner with the same flat surface.

The fix was validated in the dev window and then in the installed arm64 bundle. `typecheck`, `lint`, production build, desktop smoke, Lens action smoke, and tutoring smoke all pass after the change.

## Lens interaction overhaul: Clicky-style selection

The pre-selection Lens panel is retired from the normal invocation path. Lens now uses a deterministic interaction state machine (`packages/intelligence/lens-interaction.ts`) with a 260 ms hold threshold and a 300 ms double-tap window:

- Hold Option/Alt + Space, draw a freeform enclosure while the microphone listens, and release to submit once. The overlay is transparent and spans the virtual multi-display bounds; the trusted main process captures the padded/clamped region and routes the request through the existing provider and tutoring boundaries.
- Double-tap the same shortcut, draw a selection, then type in the focused compact field. Enter submits, Shift+Enter inserts a newline, and Escape cancels.
- A short single tap expires without opening an overlay, so it never flashes the voice flow or submits an empty request.
- The answer is shown in a compact, selectable, non-blocking Lens surface. Existing source, note, Notes, mistake, follow-up, and explicit resource actions remain available under `Save or continue`.

The macOS shortcut uses the small listen-only CoreGraphics helper `apps/desktop/electron/lens-hotkey.c` for reliable key-down/key-up edges. It never suppresses input. If Input Monitoring is unavailable, the app reports the exact System Settings path and keeps the in-app typed Lens entry point available. Microphone access is granted only to the Lens renderer; all other permission requests remain denied.

Deterministic coverage now includes hold/double-tap arbitration, duplicate-submit prevention, cancellation, bounded selection geometry, tiny selections, and the existing provider action rejection tests. `scripts/smoke-desktop.mjs` and `scripts/smoke-lens-actions.mjs` exercise the new typed flow against the built Electron app. Synthetic provider fixtures prove interaction and security behavior only; live model quality and microphone transcription remain external/device-dependent.
