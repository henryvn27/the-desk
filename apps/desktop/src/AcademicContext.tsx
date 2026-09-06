import { useState } from "react";
import {
  academicPeriodInput,
  spaceInput,
  type AcademicPeriod,
  type AcademicPeriodInput,
  type Command,
  type Snapshot,
  type Space,
  type SpaceInput,
} from "../../../packages/domain/contracts";
import { userError } from "./errors";

export function AcademicContext({
  data,
  save,
}: {
  data: Snapshot;
  save: (command: Command) => Promise<unknown>;
}) {
  const [editingPeriod, setEditingPeriod] = useState<
    AcademicPeriod | null | undefined
  >();
  const [editingSpace, setEditingSpace] = useState<Space | null | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function change(command: Command) {
    setBusy(true);
    setError("");
    try {
      await save(command);
      setEditingPeriod(undefined);
      setEditingSpace(undefined);
    } catch (caught) {
      setError(userError(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h1>Academic context</h1>
      <p>
        Keep the school structure explicit. Academic periods and spaces group
        classes for context without changing task ordering or inventing school
        connections.
      </p>
      <div className="actions">
        <button
          disabled={
            busy || editingPeriod !== undefined || editingSpace !== undefined
          }
          onClick={() => {
            setEditingPeriod(null);
            setError("");
          }}
        >
          Add academic period
        </button>
        <button
          disabled={
            busy || editingPeriod !== undefined || editingSpace !== undefined
          }
          onClick={() => {
            setEditingSpace(null);
            setError("");
          }}
        >
          Add space
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {editingPeriod !== undefined && (
        <PeriodForm
          data={data}
          existing={editingPeriod}
          busy={busy}
          close={() => setEditingPeriod(undefined)}
          submit={(input) =>
            void change(
              editingPeriod
                ? {
                    type: "period.update",
                    id: editingPeriod.id,
                    revision: editingPeriod.revision,
                    input,
                  }
                : { type: "period.create", input },
            )
          }
        />
      )}
      {editingSpace !== undefined && (
        <SpaceForm
          data={data}
          existing={editingSpace}
          busy={busy}
          close={() => setEditingSpace(undefined)}
          submit={(input) =>
            void change(
              editingSpace
                ? {
                    type: "space.update",
                    id: editingSpace.id,
                    revision: editingSpace.revision,
                    input,
                  }
                : { type: "space.create", input },
            )
          }
        />
      )}
      {!data.academicPeriods.length && (
        <p className="muted">No academic periods recorded yet.</p>
      )}
      {data.academicPeriods.map((period) => (
        <article className="source" key={period.id}>
          <h2>{period.name}</h2>
          <p className="muted">
            {period.kind} · {formatDateRange(period.startsOn, period.endsOn)} ·{" "}
            {period.classIds.length} linked class
            {period.classIds.length === 1 ? "" : "es"}
          </p>
          <ClassNames data={data} classIds={period.classIds} />
          {period.notes && <p>{period.notes}</p>}
          <div className="actions">
            <button
              disabled={busy}
              onClick={() => {
                setEditingPeriod(period);
                setError("");
              }}
            >
              Edit period
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void change({
                  type: "period.forget",
                  id: period.id,
                  revision: period.revision,
                })
              }
            >
              Forget period
            </button>
          </div>
        </article>
      ))}
      {!data.spaces.length && <p className="muted">No spaces recorded yet.</p>}
      {data.spaces.map((space) => (
        <article className="source" key={space.id}>
          <h2>{space.name}</h2>
          <p className="muted">
            {space.kind} · {space.classIds.length} linked class
            {space.classIds.length === 1 ? "" : "es"}
          </p>
          <ClassNames data={data} classIds={space.classIds} />
          {space.notes && <p>{space.notes}</p>}
          <div className="actions">
            <button
              disabled={busy}
              onClick={() => {
                setEditingSpace(space);
                setError("");
              }}
            >
              Edit space
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void change({
                  type: "space.forget",
                  id: space.id,
                  revision: space.revision,
                })
              }
            >
              Forget space
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}

function ClassNames({
  data,
  classIds,
}: {
  data: Snapshot;
  classIds: string[];
}) {
  return (
    <p className="muted">
      {classIds.length
        ? classIds
            .map(
              (classId) =>
                data.classes.find((course) => course.id === classId)?.name ??
                "Unknown class",
            )
            .join(" · ")
        : "No classes linked"}
    </p>
  );
}

function formatDateRange(startsOn: string | null, endsOn: string | null) {
  if (!startsOn && !endsOn) return "dates unspecified";
  return `${startsOn ?? "open"} → ${endsOn ?? "open"}`;
}

function PeriodForm({
  data,
  existing,
  busy,
  close,
  submit,
}: {
  data: Snapshot;
  existing: AcademicPeriod | null;
  busy: boolean;
  close: () => void;
  submit: (input: AcademicPeriodInput) => void;
}) {
  return (
    <form
      key={existing?.id ?? "new-period"}
      onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        submit(
          academicPeriodInput.parse({
            name: String(values.get("name")),
            kind: String(values.get("kind")),
            startsOn: String(values.get("startsOn")) || null,
            endsOn: String(values.get("endsOn")) || null,
            notes: String(values.get("notes")),
            classIds: values.getAll("classIds").map(String),
          }),
        );
      }}
    >
      <h2>{existing ? "Edit academic period" : "Add academic period"}</h2>
      <label>
        Period name
        <input
          name="name"
          aria-label="Period name"
          required
          maxLength={200}
          defaultValue={existing?.name ?? ""}
        />
      </label>
      <label>
        Period kind
        <select
          name="kind"
          aria-label="Period kind"
          defaultValue={existing?.kind ?? "semester"}
        >
          <option value="semester">Semester</option>
          <option value="trimester">Trimester</option>
          <option value="quarter">Quarter</option>
          <option value="year">Year</option>
          <option value="summer">Summer</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label>
        Period starts
        <input
          name="startsOn"
          aria-label="Period starts"
          type="date"
          defaultValue={existing?.startsOn ?? ""}
        />
      </label>
      <label>
        Period ends
        <input
          name="endsOn"
          aria-label="Period ends"
          type="date"
          defaultValue={existing?.endsOn ?? ""}
        />
      </label>
      <label>
        Period notes
        <textarea
          name="notes"
          aria-label="Period notes"
          maxLength={5000}
          defaultValue={existing?.notes ?? ""}
        />
      </label>
      <fieldset>
        <legend>Period classes</legend>
        {data.classes.map((course) => (
          <label key={course.id}>
            <input
              type="checkbox"
              name="classIds"
              value={course.id}
              defaultChecked={existing?.classIds.includes(course.id)}
            />
            {course.name}
          </label>
        ))}
      </fieldset>
      <div className="actions">
        <button type="button" onClick={close}>
          Cancel
        </button>
        <button className="primary" disabled={busy}>
          Save academic period
        </button>
      </div>
    </form>
  );
}

function SpaceForm({
  data,
  existing,
  busy,
  close,
  submit,
}: {
  data: Snapshot;
  existing: Space | null;
  busy: boolean;
  close: () => void;
  submit: (input: SpaceInput) => void;
}) {
  return (
    <form
      key={existing?.id ?? "new-space"}
      onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        submit(
          spaceInput.parse({
            name: String(values.get("name")),
            kind: String(values.get("kind")),
            notes: String(values.get("notes")),
            classIds: values.getAll("classIds").map(String),
          }),
        );
      }}
    >
      <h2>{existing ? "Edit space" : "Add space"}</h2>
      <label>
        Space name
        <input
          name="name"
          aria-label="Space name"
          required
          maxLength={200}
          defaultValue={existing?.name ?? ""}
        />
      </label>
      <label>
        Space kind
        <select
          name="kind"
          aria-label="Space kind"
          defaultValue={existing?.kind ?? "school"}
        >
          <option value="school">School</option>
          <option value="program">Program</option>
          <option value="workspace">Workspace</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label>
        Space notes
        <textarea
          name="notes"
          aria-label="Space notes"
          maxLength={5000}
          defaultValue={existing?.notes ?? ""}
        />
      </label>
      <fieldset>
        <legend>Space classes</legend>
        {data.classes.map((course) => (
          <label key={course.id}>
            <input
              type="checkbox"
              name="classIds"
              value={course.id}
              defaultChecked={existing?.classIds.includes(course.id)}
            />
            {course.name}
          </label>
        ))}
      </fieldset>
      <div className="actions">
        <button type="button" onClick={close}>
          Cancel
        </button>
        <button className="primary" disabled={busy}>
          Save space
        </button>
      </div>
    </form>
  );
}
