import { Rebalance } from "./Rebalance";
import { useState } from "react";
import type {
  Block,
  Command,
  Snapshot,
  StudyBlock,
} from "../../../packages/domain/contracts";
import type { planWeek } from "../../../packages/planner";
import { userError } from "./errors";
function localInput(value: string) {
  const d = new Date(value);
  return new Date(+d - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function StudyPlan({
  data,
  week,
  save,
}: {
  data: Snapshot;
  week: ReturnType<typeof planWeek>;
  save: (c: Command) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState<Block | StudyBlock>();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const days = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + offset);
    return date;
  });
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  const label = (b: Block) =>
    data.tasks.find((t) => t.id === b.taskId)?.title ?? "Assignment";
  const row = (b: Block, saved: boolean) => (
    <section
      className="row"
      key={"id" in b ? String(b.id) : b.taskId + b.start}
    >
      <div>
        <strong>{label(b)}</strong>
        <p>
          {new Date(b.start).toLocaleString([], {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}{" "}
          · {b.minutes} minutes
        </p>
        <small>
          {saved
            ? "locked" in b && b.locked
              ? "Locked · "
              : "Saved · "
            : "Suggested · "}
          {b.why}
        </small>
        {saved && +new Date(b.end) < Date.now() && (
          <p>
            Time has passed. Review the assignment’s remaining work; this block
            does not mark it complete.
          </p>
        )}
      </div>
      <button
        disabled={busy}
        onClick={() => {
          setEditing(b);
          setStatus("");
        }}
      >
        {saved ? "Edit block" : "Reserve time"}
      </button>
    </section>
  );
  return (
    <>
      <h1>Your plan</h1>
      <p>
        {data.planningMode === "auto-plan"
          ? "Auto-plan reserves time for newly captured work. Existing commitments stay in place."
          : "Suggest mode: reserve proposed time when you are ready."}
      </p>
      <p className="muted">
        Next seven days · {data.planning.studyStart}–{data.planning.sleepCutoff}{" "}
        local time · {data.planning.bufferPercent}% breathing room
      </p>
      <p>
        Saved blocks stay where you put them. Suggestions use the time around
        them.
      </p>
      <Rebalance data={data} save={save} />
      <section aria-label="Plan history">
        <h2>Plan history</h2>
        {data.plans.length ? (
          data.plans.slice(0, 8).map((plan) => (
            <div className="row" key={plan.id}>
              <div>
                <strong>
                  {plan.trigger === "auto-plan" ? "Auto-plan" : "Rebalance"}
                </strong>
                <p>
                  {new Date(plan.createdAt).toLocaleString()} ·{" "}
                  {plan.blockIds.length} saved block
                  {plan.blockIds.length === 1 ? "" : "s"}
                </p>
                <small>
                  {plan.overloadMinutes > 0
                    ? `${plan.overloadMinutes} minutes still need time.`
                    : "No unscheduled required minutes recorded."}
                </small>
              </div>
            </div>
          ))
        ) : (
          <p className="muted">
            Committed Auto-plan and rebalance versions will appear here.
          </p>
        )}
      </section>
      <div className="plan-week" aria-label="Seven-day saved blocks">
        {days.map((day) => (
          <section
            className="plan-day"
            key={day.toISOString()}
            aria-label={day.toLocaleDateString([], {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("application/x-desk-block")) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (busy) return;
              const block = data.studyBlocks.find(
                (b) =>
                  b.id === e.dataTransfer.getData("application/x-desk-block") &&
                  !b.cancelledAt,
              );
              if (!block) return;
              const start = new Date(block.start);
              start.setFullYear(
                day.getFullYear(),
                day.getMonth(),
                day.getDate(),
              );
              setEditing({
                ...block,
                start: start.toISOString(),
                end: new Date(+start + block.minutes * 60000).toISOString(),
              });
              setStatus("Review the new day and save to move this block.");
            }}
          >
            <h3>
              {day.toLocaleDateString([], { weekday: "short", day: "numeric" })}
            </h3>
            {data.studyBlocks
              .filter((b) => !b.cancelledAt && sameDay(new Date(b.start), day))
              .map((b) => (
                <button
                  key={b.id}
                  className="plan-day-block"
                  draggable={!busy}
                  disabled={busy}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/x-desk-block", b.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onClick={() => {
                    setEditing(b);
                    setStatus("");
                  }}
                >
                  <strong>{label(b)}</strong>
                  <span>
                    {new Date(b.start).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}{" "}
                    · {b.minutes}m{b.locked ? " · Locked" : ""}
                  </span>
                </button>
              ))}
            <small>Drop a block here</small>
          </section>
        ))}
      </div>
      <p className="muted">
        Drag saved blocks between days, then review and save. You can also use
        Edit block to choose an exact time.
      </p>
      {editing && (
        <section>
          <h2>{"id" in editing ? "Edit saved block" : "Reserve study time"}</h2>
          <p>{label(editing)}</p>
          <form
            key={
              ("id" in editing ? editing.id : editing.taskId) + editing.start
            }
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              setBusy(true);
              setStatus("");
              const input = {
                start: new Date(String(form.get("start"))).toISOString(),
                minutes: Number(form.get("minutes")),
              };
              const beyondDeadlineApproved = form.has("deadline");
              const cancelling =
                (e.nativeEvent as SubmitEvent).submitter?.getAttribute(
                  "value",
                ) === "release";
              const c: Command =
                cancelling && "id" in editing
                  ? {
                      type: "block.cancel",
                      id: editing.id,
                      revision: editing.revision,
                      cancellationApproved: form.has("approveCancel"),
                    }
                  : "id" in editing
                    ? {
                        type: "block.update",
                        id: editing.id,
                        revision: editing.revision,
                        input,
                        locked: form.has("locked"),
                        lockedChangeApproved: form.has("approveLock"),
                        beyondDeadlineApproved,
                      }
                    : {
                        type: "block.create",
                        taskId: editing.taskId,
                        input,
                        beyondDeadlineApproved,
                      };
              void save(c)
                .then(() => {
                  setEditing(undefined);
                  setStatus(
                    cancelling
                      ? "Reserved time released. The assignment still needs its remaining work."
                      : "Study block saved.",
                  );
                })
                .catch((e) => setStatus(userError(e)))
                .finally(() => setBusy(false));
            }}
          >
            <div className="fields">
              <label>
                Start time
                <input
                  name="start"
                  type="datetime-local"
                  required
                  defaultValue={localInput(
                    "id" in editing
                      ? editing.start
                      : new Date(
                          Math.max(
                            +new Date(editing.start),
                            Date.now() + 120000,
                          ),
                        ).toISOString(),
                  )}
                />
              </label>
              <label>
                Minutes
                <input
                  name="minutes"
                  type="number"
                  min="5"
                  max="2400"
                  required
                  defaultValue={editing.minutes}
                />
              </label>
            </div>
            {"id" in editing && (
              <label>
                <input
                  name="locked"
                  type="checkbox"
                  defaultChecked={editing.locked}
                />{" "}
                Lock this block
              </label>
            )}
            {"id" in editing && editing.locked && (
              <label>
                <input name="approveLock" type="checkbox" /> I approve moving or
                unlocking this locked block
              </label>
            )}
            <label>
              <input name="deadline" type="checkbox" /> Allow this block to end
              after the assignment deadline
            </label>
            {"id" in editing && (
              <label>
                <input type="checkbox" name="approveCancel" />{" "}
                {editing.locked
                  ? "I approve cancelling this locked block; keep the assignment"
                  : "I approve releasing this reserved time; keep the assignment"}
              </label>
            )}
            <div className="actions">
              <button disabled={busy}>Save block</button>
              {"id" in editing && (
                <button type="submit" value="release" disabled={busy}>
                  Release reserved time
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditing(undefined)}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}
      <p role="status">{status}</p>
      <h2>Saved blocks</h2>
      {data.studyBlocks.some((b) => !b.cancelledAt) ? (
        data.studyBlocks.filter((b) => !b.cancelledAt).map((b) => row(b, true))
      ) : (
        <p>No saved blocks yet. Reserve a suggestion to keep its place.</p>
      )}
      {data.studyBlocks.some((b) => b.cancelledAt) && (
        <details>
          <summary>Released blocks</summary>
          {data.studyBlocks
            .filter((b) => b.cancelledAt)
            .map((b) => (
              <p key={b.id}>
                {label(b)} · {b.minutes} minutes · released{" "}
                {new Date(b.cancelledAt!).toLocaleString()}
              </p>
            ))}
        </details>
      )}
      <h2>Suggested time</h2>
      {week.blocks.length ? (
        week.blocks.map((b) => row(b, false))
      ) : (
        <p>No additional study blocks fit in the next seven days.</p>
      )}
      {!!week.unscheduled.length && (
        <section>
          <h2>Still needs time</h2>
          {week.unscheduled.map((u) => (
            <p key={u.taskId}>
              {data.tasks.find((t) => t.id === u.taskId)?.title} · {u.minutes}{" "}
              min · {u.reason}
            </p>
          ))}
        </section>
      )}
    </>
  );
}
