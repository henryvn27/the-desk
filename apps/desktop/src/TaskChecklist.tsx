import { useState } from "react";
import type {
  ChecklistItem,
  Command,
  Task,
} from "../../../packages/domain/contracts";
import { userError } from "./errors";

type Save = (command: Command) => Promise<unknown>;
function Item({
  item,
  task,
  save,
}: {
  item: ChecklistItem;
  task: Task;
  save: Save;
}) {
  const [draft, setDraft] = useState<ChecklistItem>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function update(
    base: ChecklistItem,
    input: { title: string; completed: boolean; archived: boolean },
  ) {
    setBusy(true);
    setError("");
    try {
      await save({
        type: "checklist.update",
        taskId: task.id,
        id: base.id,
        revision: base.revision,
        input,
      });
      setDraft(undefined);
    } catch (e) {
      setError(userError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <li>
      {draft ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const title = String(new FormData(e.currentTarget).get("title"));
            void update(draft, {
              title,
              completed: draft.completed,
              archived: draft.archived,
            });
          }}
        >
          <label>
            Step name
            <input
              aria-label="Step name"
              name="title"
              required
              maxLength={500}
              defaultValue={draft.title}
            />
          </label>
          <button type="button" onClick={() => setDraft(undefined)}>
            Cancel step edit
          </button>
          <button disabled={busy || task.completed}>Save step</button>
        </form>
      ) : (
        <>
          <label className="check">
            <input
              type="checkbox"
              checked={item.completed}
              disabled={busy || task.completed || item.archived}
              onChange={(e) =>
                void update(item, {
                  title: item.title,
                  completed: e.target.checked,
                  archived: item.archived,
                })
              }
            />
            {item.title}
          </label>
          {!task.completed && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setError("");
                  setDraft({ ...item });
                }}
              >
                Edit step
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void update(item, {
                    title: item.title,
                    completed: item.completed,
                    archived: !item.archived,
                  })
                }
              >
                {item.archived ? "Restore step" : "Archive step"}
              </button>
            </>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </li>
  );
}
export function TaskChecklist({ task, save }: { task: Task; save: Save }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const items = task.checklist ?? [];
  const visible = items.filter((item) => !item.archived);
  return (
    <section className="task-checklist" aria-label="Assignment checklist">
      <h4>
        Checklist · {visible.filter((item) => item.completed).length} of{" "}
        {visible.length} checked
      </h4>
      <p className="muted">
        Your reported steps. Completing the checklist does not mark the
        assignment finished.
      </p>
      <ul>
        {visible.map((item) => (
          <Item key={item.id} item={item} task={task} save={save} />
        ))}
      </ul>
      {!task.completed && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const title = String(new FormData(form).get("title"));
            setBusy(true);
            setError("");
            try {
              await save({ type: "checklist.add", taskId: task.id, title });
              form.reset();
            } catch (e) {
              setError(userError(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Add a step
            <input
              aria-label="Add a step"
              name="title"
              required
              maxLength={500}
            />
          </label>
          <button disabled={busy}>Add step</button>
        </form>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {items.some((item) => item.archived) && (
        <details>
          <summary>Archived steps</summary>
          <ul>
            {items
              .filter((item) => item.archived)
              .map((item) => (
                <Item key={item.id} item={item} task={task} save={save} />
              ))}
          </ul>
        </details>
      )}
    </section>
  );
}
