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
  openReader,
}: {
  data: Snapshot;
  classId?: string;
  search: string;
  save: (input: SourceInput) => Promise<unknown>;
  classify: (source: Source, kind: SourceKind) => Promise<unknown>;
  openReader: (source: Source) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [scopeQuestion, setScopeQuestion] = useState("");
  const [scopeMode, setScopeMode] = useState<"compare" | "synthesize" | "guide" | "quiz">("compare");
  const [scopeStatus, setScopeStatus] = useState("");
  const sources = data.sources.filter(
    (s) =>
      (!classId ||
        s.classIds.includes(classId) ||
        s.taskIds.some((id) =>
          data.tasks.some((t) => t.id === id && t.classId === classId),
        )) &&
      `${s.title} ${s.text} ${(s.annotations ?? []).map((annotation) => `${annotation.text} ${annotation.comment}`).join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <section>
      <div className="actions">
        <h2>Sources</h2>
        <button onClick={() => setAdding(true)}>Save text source</button>
      </div>
      <section className="source-workbench" aria-label="Source comparison workspace">
        <div className="eyebrow">Reading workspace</div>
        <h3>Connect sources</h3>
        <p className="muted">Select saved sources to compare, synthesize, make a study guide, or quiz yourself. Lens receives only this explicit scope and keeps each source's reported authority visible.</p>
        <div className="source-scope-picker">
          {sources.map((source) => (
            <label className="check" key={source.id}>
              <input
                type="checkbox"
                checked={selectedSourceIds.includes(source.id)}
                onChange={() => setSelectedSourceIds((current) => current.includes(source.id) ? current.filter((id) => id !== source.id) : [...current, source.id].slice(-20))}
              />
              <span>{source.title}<small>{formatLabels[source.format ?? "text"]} · rev {source.revision ?? 0} · {source.kind ?? "unspecified"}</small></span>
            </label>
          ))}
          {!sources.length && <span className="muted">Save a source to build a reading scope.</span>}
        </div>
        {!!selectedSourceIds.length && (
          <div className="source-workbench-form">
            <select aria-label="Source question mode" value={scopeMode} onChange={(event) => setScopeMode(event.target.value as typeof scopeMode)}>
              <option value="compare">Compare selected sources</option>
              <option value="synthesize">Synthesize selected sources</option>
              <option value="guide">Create a study guide</option>
              <option value="quiz">Quiz me from these sources</option>
            </select>
            <input aria-label="Question about selected sources" value={scopeQuestion} onChange={(event) => setScopeQuestion(event.target.value)} placeholder="What should I connect?" maxLength={4_000} />
            <button className="primary" type="button" onClick={() => {
              const request = scopeQuestion.trim() || (scopeMode === "compare" ? "Compare these sources and cite where they agree or differ." : scopeMode === "synthesize" ? "Synthesize the selected sources with a citation for each grounded claim." : scopeMode === "guide" ? "Create a study guide from the selected sources and cite each section." : "Quiz me from the selected sources and cite the source for each correction.");
              setScopeStatus("Opening Lens with this source scope…");
              void window.desk.lens({ question: request, sourceIds: selectedSourceIds }).catch(() => setScopeStatus("Lens could not be opened."));
            }}>Ask Lens with scope</button>
            <button type="button" onClick={() => setSelectedSourceIds([])}>Clear</button>
          </div>
        )}
        {scopeStatus && <p className="muted" role="status">{scopeStatus}</p>}
      </section>
      {sources.map((s) => (
        <details key={s.id} className="source">
          <summary>
            <span className="source-summary-title"><input type="checkbox" aria-label={`Use ${s.title} in source scope`} checked={selectedSourceIds.includes(s.id)} onClick={(event) => event.stopPropagation()} onChange={() => setSelectedSourceIds((current) => current.includes(s.id) ? current.filter((id) => id !== s.id) : [...current, s.id].slice(-20))} />{s.title}</span>
            <span className="source-summary-meta">{formatLabels[s.format ?? "text"]} · rev {s.revision ?? 0}</span>
          </summary>
          <p className="muted">
            Saved in Library · {new Date(s.createdAt).toLocaleDateString()} · {s.annotations?.length ?? 0} annotations
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
          <div className="actions source-card-actions">
            <button type="button" className="primary" onClick={() => openReader(s)}>Open reader</button>
            {s.sourceUrl && <a className="button-link" href={s.sourceUrl} target="_blank" rel="noreferrer">Original</a>}
          </div>
          {!!s.annotations?.length && (
            <p className="muted">{s.annotations.filter((annotation) => annotation.noteRefs.length).length} annotation{ s.annotations.filter((annotation) => annotation.noteRefs.length).length === 1 ? "" : "s" } linked into Notes.</p>
          )}
          <p className="source-preview">{s.text.slice(0, 320)}{s.text.length > 320 ? "…" : ""}</p>
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

const formatLabels: Record<NonNullable<SourceInput["format"]>, string> = {
  text: "Text",
  pdf: "PDF",
  slides: "Slides",
  transcript: "Transcript",
  web: "Web capture",
};
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
      <h2 id="source-heading">Save a source</h2>
      <p>
        Keep the original representation and reuse it across classes or assignments.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          void save({
            kind: sourceKind.parse(f.get("kind")),
            format: String(f.get("format")) as SourceInput["format"],
            sourceUrl: String(f.get("sourceUrl") || "") || null,
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
          Representation
          <select aria-label="Source representation" name="format" defaultValue="text">
            {(Object.keys(formatLabels) as NonNullable<SourceInput["format"]>[]).map((format) => (
              <option key={format} value={format}>{formatLabels[format]}</option>
            ))}
          </select>
        </label>
        <label>
          Original URL (optional)
          <input name="sourceUrl" type="url" placeholder="https://…" />
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
