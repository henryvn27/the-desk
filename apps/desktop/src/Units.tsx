import { useState } from "react";
import {
  trackInput,
  unitInput,
  type Command,
  type Snapshot,
  type Track,
  type TrackInput,
  type Unit,
  type UnitInput,
} from "../../../packages/domain/contracts";
import { userError } from "./errors";

export function Units({
  data,
  save,
}: {
  data: Snapshot;
  save: (command: Command) => Promise<unknown>;
}) {
  const [editingTrack, setEditingTrack] = useState<Track | null | undefined>();
  const [editingUnit, setEditingUnit] = useState<Unit | null | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function change(command: Command) {
    setBusy(true);
    setError("");
    try {
      await save(command);
      setEditingTrack(undefined);
      setEditingUnit(undefined);
    } catch (caught) {
      setError(userError(caught));
    } finally {
      setBusy(false);
    }
  }
  const orderedTracks = [...data.tracks].sort(
    (a, b) =>
      a.classId.localeCompare(b.classId) || a.name.localeCompare(b.name),
  );
  const orderedUnits = [...data.units].sort(
    (a, b) =>
      a.classId.localeCompare(b.classId) ||
      a.sequence - b.sequence ||
      a.name.localeCompare(b.name),
  );
  return (
    <section>
      <h1>Units &amp; tracks</h1>
      <p>
        Keep the class hierarchy explicit. Tracks group units inside one class;
        units and modules can link the assignments they organize without
        changing the planner's conservative ordering.
      </p>
      <div className="actions">
        <button
          disabled={
            busy || editingTrack !== undefined || editingUnit !== undefined
          }
          onClick={() => {
            setEditingTrack(null);
            setError("");
          }}
        >
          Add track
        </button>
        <button
          disabled={
            busy || editingTrack !== undefined || editingUnit !== undefined
          }
          onClick={() => {
            setEditingUnit(null);
            setError("");
          }}
        >
          Add unit / module
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {editingTrack !== undefined && (
        <TrackForm
          data={data}
          existing={editingTrack}
          busy={busy}
          close={() => setEditingTrack(undefined)}
          submit={(input) =>
            void change(
              editingTrack
                ? {
                    type: "track.update",
                    id: editingTrack.id,
                    revision: editingTrack.revision,
                    input,
                  }
                : { type: "track.create", input },
            )
          }
        />
      )}
      {editingUnit !== undefined && (
        <UnitForm
          data={data}
          existing={editingUnit}
          busy={busy}
          close={() => setEditingUnit(undefined)}
          submit={(input) =>
            void change(
              editingUnit
                ? {
                    type: "unit.update",
                    id: editingUnit.id,
                    revision: editingUnit.revision,
                    input,
                  }
                : { type: "unit.create", input },
            )
          }
        />
      )}
      {!orderedTracks.length && !orderedUnits.length && (
        <p className="muted">No tracks or units recorded yet.</p>
      )}
      {orderedTracks.map((track) => {
        const linkedUnits = orderedUnits.filter(
          (unit) => unit.trackId === track.id,
        );
        return (
          <article className="source" key={track.id}>
            <h2>{track.name}</h2>
            <p className="muted">
              {data.classes.find((course) => course.id === track.classId)?.name}
              {" · "}
              {linkedUnits.length} linked unit
              {linkedUnits.length === 1 ? "" : "s"}
            </p>
            {track.notes && <p>{track.notes}</p>}
            {linkedUnits.map((unit) => (
              <div key={unit.id}>
                <p className="muted">
                  {unit.sequence}. {unit.name} · {unit.kind} ·{" "}
                  {unit.taskIds.length} linked task
                  {unit.taskIds.length === 1 ? "" : "s"}
                </p>
                <div className="actions">
                  <button
                    disabled={busy}
                    onClick={() => {
                      setEditingUnit(unit);
                      setError("");
                    }}
                  >
                    Edit unit
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void change({
                        type: "unit.forget",
                        id: unit.id,
                        revision: unit.revision,
                      })
                    }
                  >
                    Forget unit
                  </button>
                </div>
              </div>
            ))}
            <div className="actions">
              <button
                disabled={busy}
                onClick={() => {
                  setEditingTrack(track);
                  setError("");
                }}
              >
                Edit track
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void change({
                    type: "track.forget",
                    id: track.id,
                    revision: track.revision,
                  })
                }
              >
                Forget track
              </button>
            </div>
          </article>
        );
      })}
      {orderedUnits
        .filter(
          (unit) =>
            !unit.trackId ||
            !data.tracks.some((track) => track.id === unit.trackId),
        )
        .map((unit) => (
          <article className="source" key={unit.id}>
            <h2>{unit.name}</h2>
            <p className="muted">
              {data.classes.find((course) => course.id === unit.classId)?.name}{" "}
              · {unit.kind} · {unit.taskIds.length} linked task
              {unit.taskIds.length === 1 ? "" : "s"}
            </p>
            {unit.notes && <p>{unit.notes}</p>}
            <div className="actions">
              <button
                disabled={busy}
                onClick={() => {
                  setEditingUnit(unit);
                  setError("");
                }}
              >
                Edit unit
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void change({
                    type: "unit.forget",
                    id: unit.id,
                    revision: unit.revision,
                  })
                }
              >
                Forget unit
              </button>
            </div>
          </article>
        ))}
    </section>
  );
}

function TrackForm({
  data,
  existing,
  busy,
  close,
  submit,
}: {
  data: Snapshot;
  existing: Track | null;
  busy: boolean;
  close: () => void;
  submit: (input: TrackInput) => void;
}) {
  return (
    <form
      key={existing?.id ?? "new-track"}
      onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        submit(
          trackInput.parse({
            classId: String(values.get("classId")),
            name: String(values.get("name")),
            notes: String(values.get("notes")),
          }),
        );
      }}
    >
      <h2>{existing ? "Edit track" : "Add track"}</h2>
      <label>
        Track class
        <select
          name="classId"
          aria-label="Track class"
          required
          defaultValue={existing?.classId ?? data.classes[0]?.id ?? ""}
        >
          {data.classes.map((course) => (
            <option key={course.id} value={course.id}>
              {course.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Track name
        <input
          name="name"
          aria-label="Track name"
          required
          maxLength={200}
          defaultValue={existing?.name ?? ""}
        />
      </label>
      <label>
        Track notes
        <textarea
          name="notes"
          aria-label="Track notes"
          maxLength={5000}
          defaultValue={existing?.notes ?? ""}
        />
      </label>
      <div className="actions">
        <button type="button" onClick={close}>
          Cancel
        </button>
        <button className="primary" disabled={busy || !data.classes.length}>
          Save track
        </button>
      </div>
    </form>
  );
}

function UnitForm({
  data,
  existing,
  busy,
  close,
  submit,
}: {
  data: Snapshot;
  existing: Unit | null;
  busy: boolean;
  close: () => void;
  submit: (input: UnitInput) => void;
}) {
  const [classId, setClassId] = useState(
    existing?.classId ?? data.classes[0]?.id ?? "",
  );
  const tracks = data.tracks.filter((track) => track.classId === classId);
  const tasks = data.tasks.filter((task) => task.classId === classId);
  return (
    <form
      key={existing?.id ?? "new-unit"}
      onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        submit(
          unitInput.parse({
            classId: String(values.get("classId")),
            trackId: String(values.get("trackId")) || null,
            name: String(values.get("name")),
            kind: String(values.get("kind")),
            sequence: Number(values.get("sequence")),
            notes: String(values.get("notes")),
            taskIds: values.getAll("taskIds").map(String),
          }),
        );
      }}
    >
      <h2>{existing ? "Edit unit / module" : "Add unit / module"}</h2>
      <label>
        Unit class
        <select
          name="classId"
          aria-label="Unit class"
          required
          value={classId}
          onChange={(event) => setClassId(event.currentTarget.value)}
        >
          {data.classes.map((course) => (
            <option key={course.id} value={course.id}>
              {course.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Track (optional)
        <select
          name="trackId"
          aria-label="Unit track"
          defaultValue={existing?.trackId ?? ""}
        >
          <option value="">No linked track</option>
          {tracks.map((track) => (
            <option key={track.id} value={track.id}>
              {track.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Unit / module name
        <input
          name="name"
          aria-label="Unit name"
          required
          maxLength={200}
          defaultValue={existing?.name ?? ""}
        />
      </label>
      <label>
        Kind
        <select
          name="kind"
          aria-label="Unit kind"
          defaultValue={existing?.kind ?? "unit"}
        >
          <option value="unit">Unit</option>
          <option value="module">Module</option>
        </select>
      </label>
      <label>
        Sequence
        <input
          name="sequence"
          aria-label="Unit sequence"
          type="number"
          min="0"
          max="10000"
          defaultValue={existing?.sequence ?? 0}
        />
      </label>
      <label>
        Unit tasks
        <select
          name="taskIds"
          aria-label="Unit tasks"
          multiple
          size={Math.min(6, Math.max(2, tasks.length))}
          defaultValue={existing?.taskIds ?? []}
        >
          {tasks.map((task) => (
            <option key={task.id} value={task.id}>
              {task.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        Unit notes
        <textarea
          name="notes"
          aria-label="Unit notes"
          maxLength={5000}
          defaultValue={existing?.notes ?? ""}
        />
      </label>
      <div className="actions">
        <button type="button" onClick={close}>
          Cancel
        </button>
        <button className="primary" disabled={busy || !data.classes.length}>
          Save unit
        </button>
      </div>
    </form>
  );
}
