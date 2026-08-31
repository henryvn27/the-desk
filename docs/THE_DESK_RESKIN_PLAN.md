# The Desk — original reskin plan

Status: proposed direction, not yet implemented
Reference review date: August 30, 2026
Direction revised: August 30, 2026

## Goal

The current interface proves the product architecture, but it reads like a dark macOS utility. The reskin should make The Desk feel like a place a student wants to return to: clear, optimistic, focused on progress, and always ready with one useful next step.

Acely is a product-flow reference for hierarchy, momentum, and study feedback, not a visual identity to reproduce. The Desk will not copy Acely's brand, palette, assets, copy, or proprietary layouts. It will translate the useful interaction patterns into an original native Apple system that supports classes, source material, capture, planning, tutoring, and Study Canvas.

## Product patterns worth retaining

The public Acely product surfaces consistently use:

- Persistent navigation beside a focused content canvas.
- One dominant study action instead of several equally weighted controls.
- Large daily-plan cards that answer “what should I do now?”
- Progress and accuracy shown directly beside the skill or task they describe.
- Semantic feedback placed close to the work it describes.
- Friendly, plain language with configuration moved out of the main path.
- Generous rounded surfaces, quiet borders, and selective depth.

### Visual separation rule

The Desk must not reproduce Acely's recognizable deep-navy navigation, bright-blue action, lime-progress, lavender-coaching, and warm-canvas combination—or assign near-equivalent colors to those same roles. References are for interaction hierarchy only. The Desk's own direction is **quiet, tactile, and studious**, rooted in the physical desk metaphor: graphite and paper echo the supplied app icon, while copper and moss establish a distinct product identity.

Primary references:

- [Acely AI SAT Tutor](https://acely.com/ai-sat-tutor)
- [Acely SAT prep](https://acely.com/sat-prep)
- [Acely question-bank example](https://acely.com/images/sat/hero-app.webp)
- [Acely adaptive study-plan example](https://acely.com/images/ai-sat-tutor/study-plan-adapts.webp)

## What is wrong with the current shell

1. The three-column Mac layout makes every screen feel like a database inspector, even when the student only needs to start a task.
2. The dark surfaces, thin borders, and low contrast between panels flatten the hierarchy.
3. Product limitations and integration boundaries are often explained before the student sees the useful action.
4. Planner controls appear before the plan, so the experience starts with configuration instead of a recommendation.
5. Most actions use the same size and visual weight, making it difficult to identify the primary path.
6. Classes are rows in a sidebar rather than distinct study homes with visible progress, materials, and momentum.
7. Empty, loading, setup, and disconnected states read like system status instead of guided next steps.

## Product principles

### 1. Next action first

Every top-level screen should answer one question immediately: what is the best thing to do next? Secondary information can support that answer, but should not compete with it.

### 2. Each class feels like its own course

A class home should combine the next task, mastery, upcoming work, source library, recent Canvas artifacts, and tutor entry point. A student should not have to assemble context from separate utility screens.

### 3. Progress lives beside the work

Show confidence, accuracy, due state, review status, and time spent where the student makes a decision. Avoid a separate analytics dashboard full of context-free numbers.

### 4. Sources support learning instead of leading navigation

Textbooks, notes, scans, and recordings remain canonical, but the default experience begins with a study goal. Source management becomes prominent only during capture, citation review, and library work.

### 5. Trust appears at the decision point

Keep provider identity, source provenance, calendar ownership, and submission evidence explicit. Place the explanation beside the affected action rather than repeating security copy across every screen.

### 6. Calm encouragement, never gamified pressure

Use satisfying completion, visible momentum, and constructive language. Do not add streak anxiety, leaderboards, fake urgency, confetti, or invented performance claims.

## New information architecture

### macOS

The default Mac shell becomes two columns. A contextual source or citation panel appears only when it helps the current task.

```text
The Desk
├── Home
├── Study Plan
├── Classes
│   ├── AP Physics C
│   └── AP Statistics
├── Tracks
│   ├── SAT Prep
│   └── College Essays
├── Library
├── Canvas
├── Capture
└── Settings
    └── Integrations
```

The graphite sidebar provides stable navigation. Capture stays available as a compact primary toolbar action. Study Buddy remains global and user-invoked, but is visually quieter until activated.

### iPhone

Use four primary tabs:

- Home
- Classes
- Capture
- Library

Study Plan, Canvas, and Integrations are reached from Home or the account menu. Capture remains the most prominent tab action. The iPhone should prioritize scanning, recording, quick review, and starting a planned session.

### iPad

Use the Mac hierarchy with a collapsible sidebar. Class study, Tutor, and Canvas can use a contextual split view when the second pane directly supports the task.

## Screen plan

### Home

Home becomes the momentum surface.

- Greeting and date in a compact header.
- A large “Today at The Desk” card with planned minutes, completed minutes, and one primary `Start next task` action.
- Three to five daily tasks, ordered by due work, review need, and the approved plan.
- Each row shows class, expected time, task type, and progress. Completing a row updates the plan without implying assignment submission.
- A small “Because…” explanation reveals why the task was prioritized.
- “Continue where you stopped” appears as a single resume card, not a separate dense section.
- Capture queue and offline Mac status become small operational notices only when action is required.

### Class home

Each class becomes a course dashboard with its color used as a soft background tint.

- Class title, current unit, tutor style, and a visible readiness or confidence summary.
- One primary task card: continue a source, practice a weak skill, review mistakes, or finish an assignment.
- Compact skill progress grouped by unit or topic.
- Upcoming assignments and linked calendar blocks.
- Recent sources and Canvas artifacts as visual cards.
- Local navigation: `Overview`, `Practice`, `Sources`, `Canvas`.

### Study Plan

Planning should begin with a useful recommendation.

- Show a generated weekly plan first, grouped by day.
- Each day displays total minutes and a short explanation of the priorities.
- Editing uses direct manipulation: move, shorten, skip, or replace a block.
- Advanced controls such as date range, sessions per day, and block length live in `Plan settings`.
- `Approve plan` is the single primary action.
- Calendar destination is chosen at approval time and remembered.
- Submission state remains separate from planned and completed study time.

### Practice and Tutor

Practice becomes the center of active learning rather than another chat surface.

- One question, prompt, or checkpoint dominates the page.
- A hint ladder provides `Nudge me`, `Show a step`, and `Explain it` before a final answer.
- Class sources and citations remain visible in a collapsible evidence drawer.
- After an attempt, show the exact misconception, the sourced explanation, and one similar follow-up.
- Provider and model are disclosed in a small provenance row, not in the primary header.
- A session summary records confidence, errors, and recommended next review.

### Capture

Capture becomes a fast intake flow rather than a form.

- Large drop/scan zone with four clear methods: `Scan notes`, `Add file`, `Record`, and `Paste or share`.
- A persistent destination chip names the selected class or track.
- Automatic class suggestions require one-tap confirmation.
- Processing appears as a visual pipeline: received, extracting, indexing, ready.
- Errors stay attached to the affected capture with `Retry` and `Choose another method`.
- The Mac-offline state explains that the item is safely queued and what will happen next.

### Library

- Filter by class, type, and processing state.
- Use visual source cards with cover/thumbnail, title, source type, revision, and last studied date.
- Opening a source prioritizes reading and citations; metadata moves to a secondary inspector.
- Related assignments, Canvas artifacts, and sessions appear beneath the source.

### Study Canvas

- Canvas opens as a focused full-width workspace.
- Artifact picker and revision history stay in a slim left rail.
- Scene controls appear in a contextual bottom bar.
- Practice transformations are prominent actions: hide labels, predict, reorder, change parameters, and explain aloud.
- Staleness appears as a clear update banner with `Review changes`, not a warning-heavy status panel.
- Source anchors open in a temporary evidence drawer.

### Integrations and account setup

- Move Integrations under Settings so connector health does not compete with studying.
- Group cards as `AI`, `School`, `Planning`, and `Capture`.
- Each card has one state, one explanation, and one action.
- Codex uses a `Connect ChatGPT` flow with automatic status completion and no API-key language.
- NotebookLM uses guided managed-engine setup and distinguishes installation, authentication, and service failure.
- BYOK fields appear only after the student chooses `Add another AI provider`.
- Privacy and write boundaries appear in a review sheet immediately before authorization.

### Study Buddy — Clicky inside The Desk

Study Buddy becomes The Desk's first-class Clicky mode. The interaction should
feel as immediate as Clicky while remaining grounded in the active class and
using The Desk's provider, source, privacy, and artifact systems.

- A configurable global hold-to-talk shortcut starts a visible voice turn without activating The Desk.
- Releasing the shortcut takes one clearly indicated snapshot of the approved display, window, or region; it never starts continuous screen recording.
- A small graphite coach card follows the cursor and streams the answer while the lecture, video, worksheet, or browser keeps focus.
- The compact card expands only on request to show class citations, provider/model, transcript, and `Save to Canvas`.
- Validated `OverlayCueSpec` highlights and labels the relevant region without moving the real cursor, clicking, typing, or executing model-authored commands.
- The active class contributes its tutor profile, retrieved notes, and recent session context. Switching classes is explicit and visible in the coach card.
- System speech is the local default. Optional voice providers remain normal AI-harness adapters with separate consent and credentials.
- Conversation memory is session-scoped by default; saving a turn to the class or Canvas is explicit.
- Screenshots remain one-time, user-triggered, and unretained by default. The response card and cues must never steal focus.
- The public Clicky repository's MIT-licensed non-activating response-panel pattern is retained with attribution; its Cloudflare proxy, vendor-specific APIs, analytics, prompts, assets, and raw coordinate-tag protocol are not imported.

The foundation already has explicit ScreenCaptureKit target confirmation, a
hold-Option-Space voice turn with capture on release, OCR, class grounding,
provider routing, local speech, typed cues, save to Canvas, capture purge on
close, a non-activating panel, and a cursor-following streaming response card.
The remaining parity work is configurable shortcut selection, live on-screen
cue placement outside the preview, compact/expanded transitions, and
multi-turn session memory.

## Visual system

### Color

| Token | Value | Purpose |
|---|---:|---|
| Desk Graphite | `#25282B` | Sidebar and focused study chrome |
| Desk Copper | `#9D4E31` | Primary action, links, and selection |
| Desk Moss | `#50705A` | Verified progress and healthy momentum |
| Soft Clay | `#E8D7CC` | Plans, coaching, and low-pressure focus areas |
| Desk Paper | `#F7F4ED` | Main content canvas |
| Parchment | `#E8E2D7` | Secondary background |
| Desk Ink | `#1F2326` | Primary text |
| Muted Ink | `#656A67` | Secondary text |
| Hairline | `#D6D0C5` | Quiet structure |
| Success | `#3F765A` | Verified completion and healthy connections |
| Warning | `#A66A25` | Review required |
| Danger | `#A34848` | Destructive or final failure only |

White text on Desk Copper is `5.89:1`; Desk Ink on Desk Paper is `14.41:1`; Muted Ink on Desk Paper is `5.02:1`. These pass WCAG AA for their intended text sizes. Class colors should tint a surface or small marker, never recolor the entire interface. Dark mode should be designed independently rather than generated by inverting the light palette.

### Type

- Use SF Pro Display for page and card titles.
- Use SF Pro Text for body, controls, and metadata.
- Remove the current serif treatment from routine product headings.
- Reserve New York for textbook excerpts or intentionally editorial Canvas artifacts.
- Use tabular figures for scores, time, percentages, and aligned progress.

### Shape, depth, and spacing

- Control radius: 10 points.
- Card radius: 16 points.
- Hero and modal radius: 24 points.
- Use hairlines for dense lists and a soft shadow only for primary cards, floating panels, and overlays.
- Keep the 8-point spacing system, with 24–32 points between major sections.
- Desktop content max width: 1,080 points. Reading and practice content max width: 760 points.

### Motion

- Task completion: quick check transition and progress update, no confetti.
- Navigation: short crossfade or platform-native push.
- Cards: small hover elevation on Mac; no scale effects on touch.
- Canvas changes: source-to-result transitions should explain causality.
- Respect Reduce Motion and avoid autoplaying decorative movement.

## Component inventory

Build the reskin from a compact shared component set:

- `DeskSidebar`
- `DeskPageHeader`
- `PrimaryStudyCard`
- `DailyTaskRow`
- `SubjectProgressCard`
- `ProgressChip`
- `MasteryBar`
- `CoachMessage`
- `SourceCard`
- `CanvasPreviewCard`
- `EvidenceDrawer`
- `ConnectionCard`
- `GuidedSetupCard`
- `PlanDayColumn`
- `ProcessingTimeline`
- `DeskEmptyState`
- `DeskNotice`
- `BottomStudyBar`

These components should own spacing, typography, color semantics, focus behavior, hover behavior, VoiceOver labels, and mobile reflow. Screens should compose them instead of creating one-off cards.

## State design

Every redesigned surface must include:

- Populated
- First-use empty
- Loading or processing
- Offline Mac or queued work
- Permission required
- Authentication required
- Retryable failure
- Final failure with recovery path
- Stale source or Canvas revision
- Reduced motion
- Large Dynamic Type

Alerts should be reserved for destructive confirmation or a failure that blocks the entire current action. Connector setup and recoverable problems belong inline.

## Accessibility requirements

- Text and controls must meet WCAG AA contrast in both appearances.
- Never use color alone for accuracy, state, class, or completion.
- Maintain 44-point touch targets on iPhone and iPad.
- Full keyboard navigation and clear focus rings on Mac and iPad.
- VoiceOver announces task state, expected duration, class, and the result of completion.
- Progress views have descriptive labels, not just percentages.
- Canvas has an accessible summary and data-table alternative.
- Layout must remain usable at the largest Dynamic Type sizes and with the inspector closed.

## Implementation sequence

Implementation is Mac-first. The new Home and class-home direction should be built, rendered, and approved on macOS before the same visual language spreads across every workflow. The iPhone and iPad companion remain functional during that checkpoint, then receive platform-specific adaptations rather than compressed copies of the Mac screen.

### Phase 0 — visual baseline

- Freeze current behavior and add representative screenshot fixtures for Home, a class, Planner, Capture, Tutor, Canvas, Integrations, and error/setup states.
- Separate product state from the existing view-specific layout where needed.
- Add a feature flag so the reskin can be developed without breaking the functional shell.

Exit: every core workflow has a stable fixture and the old shell remains usable.

### Phase 1 — tokens, components, and app shell

- Replace the current palette, radius, typography, and surface primitives.
- Build the graphite sidebar, paper content canvas, page header, cards, progress components, empty states, and notices.
- Change Mac from a permanent three-column split to two columns plus a contextual evidence drawer.
- Rebuild iPhone tabs and iPad adaptive navigation.

Exit: all destinations use the new shell and shared components, even if their inner content is still transitional.

### Phase 2 — Home and class homes

- Build the daily plan, next-task hierarchy, resume state, and reason-for-priority disclosure.
- Build class overview, skill progress, upcoming work, source previews, and recent Canvas artifacts.
- Add satisfying, accessible task-completion transitions.

Exit: a student can open The Desk and begin the right task within two actions.

### Phase 3 — Planner, Capture, and Library

- Make the recommended weekly plan the default Planner state.
- Move advanced plan settings behind disclosure and preserve review-before-calendar behavior.
- Rebuild Capture around four fast methods and an inline processing timeline.
- Rebuild Library around visual source cards and reading-first source detail.

Exit: planning and capture feel guided, and all current safety boundaries remain intact.

### Phase 4 — Practice, Tutor, Canvas, and Study Buddy

- Build the question-first practice surface and hint ladder.
- Turn chat into a contextual coach beside active work.
- Make Canvas a focused workspace with an evidence drawer and bottom study controls.
- Finish configurable Clicky-mode shortcuts, live typed cue placement, compact/expanded Study Buddy states, and session memory without changing the implemented hold-to-talk or explicit-capture boundary.

Exit: the learning experience, not source administration, is the visual center of the product.

### Phase 5 — Integrations and setup

- Move integrations into Settings and create guided connection cards.
- Finish seamless Codex and NotebookLM onboarding.
- Hide BYOK forms until requested.
- Replace recoverable setup alerts with inline status and recovery.

Exit: a new user can understand and connect optional services without encountering a dead end.

### Phase 6 — adaptive polish and proof

- Complete iPhone, iPad, keyboard, pointer, Dynamic Type, VoiceOver, Reduce Motion, light, and dark treatments.
- Run screenshot comparison at representative Mac, iPhone, and iPad sizes.
- Record the Home → task → Tutor → completion flow and the Capture → Mac processing → cited result flow.
- Dogfood the new shell with a full textbook, photographed notes, a recording, real assignments, and a week of calendar blocks.

Exit: no screen falls back to the old visual language and all acceptance flows are visually and functionally verified.

## File-level implementation map

| Area | Primary files |
|---|---|
| Tokens and shared components | `DesignSystem.swift`, `Components.swift` |
| Navigation shell | `RootView.swift`, `Inspector.swift` |
| Home | `TodayView.swift` |
| Class home and practice entry | `StudySpaceView.swift` |
| Planner | `StudyPlannerView.swift` |
| Capture and library | `CaptureView.swift`, `SourceViews.swift` |
| Tutor | `TutorView.swift` |
| Canvas | `StudyCanvasView.swift` |
| Study Buddy | `StudyBuddyView.swift`, `StudyBuddyPanelController.swift` |
| Settings and connectors | `IntegrationsView.swift`, `NotebookLMManagerView.swift` |

## Reskin acceptance criteria

- On launch, the highest-priority study action is visually obvious within two seconds.
- Starting the recommended task takes no more than two actions from Home.
- No primary screen uses a permanent third column.
- Every screen has exactly one dominant action in its default state.
- Class, progress, due state, and task duration are visible before starting work.
- Planner shows a recommended plan before configuration controls.
- Capture can begin with one action and choose its class with one more.
- Recoverable connector problems are inline and provide a specific next step.
- Clicky mode answers beside the cursor without activating The Desk, and no screen capture occurs before the visible user gesture.
- The light interface is the primary art direction; dark mode is equally legible and intentionally designed.
- Mac, iPhone, and iPad retain the same hierarchy while respecting platform navigation conventions.
- VoiceOver, keyboard navigation, Dynamic Type, Reduce Motion, and contrast checks pass.
- The new visual system uses no Acely logos, copy, proprietary assets, copied source code, palette, or recognizable color-role mapping.

## Definition of done

The reskin is complete when the full study loop—open Home, start the next task, consult Tutor, inspect a citation, complete the session, and see the plan update—looks and feels like one coherent product on Mac, iPhone, and iPad, while preserving The Desk's local-first execution, source provenance, and honest task-state boundaries.
