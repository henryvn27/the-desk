# Post-V1 planner optimization

The planner remains the V1 deadline, capacity, buffer, lock, overload and explainability engine. The post-V1 work adds derived planning evidence and deterministic repair helpers inside `packages/planner`; it does not add a task schema, assessment schema, second scheduler or LLM-generated time blocks.

## Benchmark first

`packages/planner/evaluation.ts` defines twelve fixed scenario families: ordinary, overloaded, exam-heavy, small-deadline, large-project, disruption, chronic underestimate, missed day, variable energy, uncertain dates, cumulative final and mixed readiness. `scripts/benchmark-planner.mjs` runs the V1 strategy and the adaptive strategy over the same fixtures and writes a reviewable comparison to `artifacts/planner/benchmark-latest.json`.

The benchmark records feasibility, deadline success, overload transparency, repair churn, academic value, buffer preservation, plan stability, user-override preservation, explanation quality, duration realism, assessment spacing and performance-pattern use. The V1 strategy is an explicit benchmark mode in the existing planner, so the comparison does not depend on a hand-edited claim.

Latest fixed-fixture comparison:

| Metric | V1 | Adaptive | Change |
| --- | ---: | ---: | ---: |
| Feasibility | 83.3% | 83.3% | unchanged |
| Deadline success | 75.0% | 75.0% | unchanged |
| Overload transparency | 100% | 100% | unchanged |
| Mean schedule churn | 1.667 | 1.667 | unchanged |
| Mean repair churn | 0.083 | 0 | -0.083 |
| Academic value | 100% | 100% | unchanged |
| Buffer preservation | 100% | 100% | unchanged |
| Plan stability | 100% | 100% | unchanged |
| Override preservation | 100% | 100% | unchanged |
| Explanation quality | 100% | 100% | unchanged |
| Duration realism | 91.7% | 100% | +8.3 points |
| Assessment spacing | 0% | 16.7% | +16.7 points |
| Performance-pattern use | 91.7% | 100% | +8.3 points |

The unchanged feasibility and deadline rows are intentional. The adaptive strategy does not trade V1 deadline behavior for better-looking study patterns.

## Improvements

- Reviewed V1 duration evidence now produces a derived lower/likely/upper range. The planner uses the upper bound only when there are at least three valid reviewed sessions, and exposes the range in the Plan surface.
- Assessment-linked preparation is distributed across available days when there is time to space it. The existing task and assessment records remain authoritative; the planner only changes allocation and explanation.
- Rebalance previews now compare a conservative repair against a full recalculation. Unlocked commitments are released only when the recalculation materially restores required minutes before a deadline. Locked and existing commitments remain protected, and the preview explains the decision.
- Repeated reviewed session history can identify a stable higher-performing time bucket for a class and work kind. The model requires repeated evidence, uses no personality label, and adds a reason to the block when it affects ordering.
- `packages/planner/what-if.ts` evaluates skipped days, extra work, moved deadlines and stop times against the same planner without persisting a hypothetical. Plan includes a small What-if panel; it is not another calendar or task system.

## Verification

Unit coverage includes duration ranges, repeated time-window evidence, planner comparison, repair stability and what-if scenarios. The existing planner/domain tests remain green after the adaptive additions. UI smoke should continue to exercise the rendered Plan and Rebalance surfaces; the benchmark deliberately remains deterministic and local.
