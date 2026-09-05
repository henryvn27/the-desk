import { useEffect, useRef, useState } from "react";
import type { Snapshot, SourceInput } from "../../../packages/domain/contracts";
import { userError } from "./errors";

export function Sources({
  data,
  classId,
  search,
  save,
}: {
  data: Snapshot;
  classId?: string;
  search: string;
  save: (input: SourceInput) => Promise<unknown>;
}) {
  const [adding, setAdding] = useState(false);
  const sources = data.sources.filter(
    (s) =>
      (!classId ||
        s.classIds.includes(classId) ||
        s.taskIds.some((id) =>
          data.tasks.some((t) => t.id === id && t.classId === classId),
        )) &&
      `${s.title} ${s.text}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <section>
      <div className="actions">
        <h2>Sources</h2>
        <button onClick={() => setAdding(true)}>Save text source</button>
      </div>
      {sources.map((s) => (
        <details key={s.id} className="source">
          <summary>{s.title}</summary>
          <p className="muted">
            Pasted by you · {new Date(s.createdAt).toLocaleDateString()}
          </p>
          <p>
            {s.classIds
              .map((id) => data.classes.find((c) => c.id === id)?.name)
              .filter(Boolean)
              .join(" · ")}
          </p>
          {s.taskIds.length > 0 && (
            <p>
              Used by:{" "}
              {s.taskIds
                .map((id) => data.tasks.find((t) => t.id === id)?.title)
                .filter(Boolean)
                .join("; ")}
            </p>
          )}
          <p className="source-text">{s.text}</p>
        </details>
      ))}
      {!sources.length && <p className="muted">No matching saved sources.</p>}
      {adding && (
        <SourceCapture
          data={data}
          classId={classId}
          save={save}
          close={() => setAdding(false)}
        />
      )}
    </section>
  );
}
function SourceCapture({
  data,
  classId,
  save,
  close,
}: {
  data: Snapshot;
  classId?: string;
  save: (input: SourceInput) => Promise<unknown>;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog ref={dialog} onCancel={close} aria-labelledby="source-heading">
      <h2 id="source-heading">Save a text source</h2>
      <p>
        Keep the original passage and reuse it across classes or assignments.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          void save({
            title: String(f.get("title")),
            text: String(f.get("text")),
            classIds: f.getAll("classes").map(String),
            taskIds: f.getAll("tasks").map(String),
          })
            .then(close)
            .catch((e) => setError(userError(e)))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Source title
          <input name="title" required maxLength={500} />
        </label>
        <label>
          Original text
          <textarea name="text" required maxLength={200000} />
        </label>
        <details>
          <summary>Link classes and assignments (optional)</summary>
          <fieldset>
            <legend>Classes</legend>
            {data.classes.map((c) => (
              <label className="check" key={c.id}>
                <input
                  type="checkbox"
                  name="classes"
                  value={c.id}
                  defaultChecked={c.id === classId}
                />
                {c.name}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Assignments</legend>
            {data.tasks
              .filter((t) => !classId || t.classId === classId)
              .map((t) => (
                <label className="check" key={t.id}>
                  <input type="checkbox" name="tasks" value={t.id} />
                  {t.title}
                </label>
              ))}
          </fieldset>
        </details>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            Save source
          </button>
        </div>
      </form>
    </dialog>
  );
}
