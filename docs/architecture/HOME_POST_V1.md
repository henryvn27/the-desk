# Home post-V1 refinement

Home remains the V1 decision surface for “what should I do now?” The renderer now consumes `deriveHome()` from `packages/planner/home.ts`; that projection calls the existing `planWeek()` once and only organizes its result into the existing hierarchy:

1. **Next** — the Planner's earliest executable block, including the next enabled study day when today has no capacity.
2. **Today** — remaining blocks that overlap today's local study window.
3. **Needs attention** — conflicts, overdue work, uncertain deadlines, unfinished session review, material plan overload, and unresolved sync decisions. Optional or merely unscheduled work stays out of this section.
4. **Upcoming** — important assessments and major near-term deadlines.
5. **Continue** — recent unfinished sessions, Notes, and assignment checklists. Source-linked Notes carry their exact `canvasId` and `blockId` backlink.

An active session uses the existing compact controller window. Home shows a short status and a focus action rather than duplicating pause, resume, activity, and finish controls. Starting Next still calls the existing `session.start` command, which creates the StudySession and controller through the trusted main process.

Recent material plan changes collapse to one short status line. The Home repair action routes to the existing canonical rebalance preview; it does not create a second planning algorithm or silently move commitments.

`Cmd/Ctrl+K` still opens global Library search and now focuses the field after the page mounts. `Cmd/Ctrl+Enter` starts the current Next item when the user is on Home and not editing a field.

## Benchmark

`npm run benchmark:home` records the shipped V1 projection beside the refined projection for normal school day, weekend, overloaded day, exam tomorrow, nothing due, missed session, uncertain deadline, plan change, active session, and offline cases. The output is written to `artifacts/home/benchmark-latest.json`.

The key measured change is weekend recovery: shipped Home produced no Next item when Saturday was not a study day; the refined projection recommends the first executable Monday block while keeping Today empty. The benchmark also shows unscheduled-item noise collapsing into one overload signal and adds the previously absent Upcoming, Continue, and plan-change outputs.
