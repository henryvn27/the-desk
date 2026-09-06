import {
  sourceKind,
  sourceKindLabels,
  type SourceKind,
} from "../../../packages/intelligence/source-kind";
import { useEffect, useRef, useState } from "react";
import type {
  Snapshot,
  SourceInput,
  Source,
} from "../../../packages/domain/contracts";
import { userError } from "./errors";

export function Sources({
  data,
  classId,
  search,
  save,
  classify,
}: {
  data: Snapshot;
  classId?: string;
  search: string;
  save: (input: SourceInput) => Promise<unknown>;
  classify: (source: Source, kind: SourceKind) => Promise<unknown>;
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
          <SourceClassification source={s} save={classify} />
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
            kind: sourceKind.parse(f.get("kind")),
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
          Source type
          <select
            aria-label="Source type"
            name="kind"
            defaultValue="unspecified"
          >
            {sourceKind.options.map((kind) => (
              <option key={kind} value={kind}>
                {sourceKindLabels[kind]}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">
          Source type is reported by you. Desk uses it to prioritize tutoring
          references.
        </p>
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

function SourceClassification({
  source,
  save,
}: {
  source: Source;
  save: (source: Source, kind: SourceKind) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <label>
        Source type (reported by you)
        <select
          aria-label={`Source type for ${source.title}`}
          value={source.kind ?? "unspecified"}
          disabled={busy}
          onChange={async (e) => {
            const kind = sourceKind.parse(e.target.value);
            setBusy(true);
            setError("");
            try {
              await save(source, kind);
            } catch (error) {
              setError(userError(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          {sourceKind.options.map((kind) => (
            <option key={kind} value={kind}>
              {sourceKindLabels[kind]}
            </option>
          ))}
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
