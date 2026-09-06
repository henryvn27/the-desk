import { useState } from "react";
import {
  userInput,
  type Command,
  type User,
  type UserInput,
} from "../../../packages/domain/contracts";
import { userError } from "./errors";

export function UserSettings({
  user,
  save,
  exportData,
  deleteData,
}: {
  user: User | null;
  save: (command: Command) => Promise<unknown>;
  exportData: () => Promise<boolean>;
  deleteData: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(user !== null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [dataBusy, setDataBusy] = useState(false);
  async function change(command: Command) {
    setBusy(true);
    setStatus("");
    try {
      await save(command);
      setStatus(
        command.type === "user.forget"
          ? "Local profile forgotten."
          : "Local profile saved.",
      );
      if (command.type === "user.forget") setEditing(false);
    } catch (caught) {
      setStatus(userError(caught));
    } finally {
      setBusy(false);
    }
  }
  async function exportLocalData() {
    setDataBusy(true);
    setStatus("");
    try {
      const saved = await exportData();
      setStatus(saved ? "Local data exported." : "Export canceled.");
    } catch (caught) {
      setStatus(userError(caught));
    } finally {
      setDataBusy(false);
    }
  }
  async function deleteLocalData() {
    setDataBusy(true);
    setStatus("");
    try {
      await deleteData();
      setEditing(false);
      setStatus("Local data deleted.");
    } catch (caught) {
      setStatus(userError(caught));
    } finally {
      setDataBusy(false);
    }
  }
  return (
    <section>
      <h2>Local profile</h2>
      <p>
        This profile names the student using this local Desk. Account login and
        school connections stay separate and are not connected in this build.
      </p>
      {!editing && (
        <button
          disabled={busy}
          onClick={() => {
            setEditing(true);
            setStatus("");
          }}
        >
          {user ? "Edit local profile" : "Add local profile"}
        </button>
      )}
      {editing && (
        <form
          key={user?.id ?? "new-user"}
          onSubmit={(event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            const parsed = userInput.safeParse({
              displayName: String(values.get("displayName")),
              email: String(values.get("email")) || null,
              timeZone: String(values.get("timeZone")),
            });
            if (!parsed.success) {
              setStatus(
                parsed.error.issues[0]?.message ?? "Check the profile fields.",
              );
              return;
            }
            const input: UserInput = parsed.data;
            void change(
              user
                ? {
                    type: "user.update",
                    id: user.id,
                    revision: user.revision,
                    input,
                  }
                : { type: "user.create", input },
            );
          }}
        >
          <label>
            Display name
            <input
              name="displayName"
              aria-label="Display name"
              required
              maxLength={200}
              defaultValue={user?.displayName ?? ""}
            />
          </label>
          <label>
            Email (optional)
            <input
              name="email"
              aria-label="Profile email"
              type="email"
              maxLength={500}
              defaultValue={user?.email ?? ""}
            />
          </label>
          <label>
            Time zone
            <input
              name="timeZone"
              aria-label="Profile time zone"
              required
              maxLength={100}
              defaultValue={
                user?.timeZone ??
                Intl.DateTimeFormat().resolvedOptions().timeZone
              }
            />
          </label>
          <div className="actions">
            <button type="button" onClick={() => setEditing(user !== null)}>
              Cancel
            </button>
            <button className="primary" disabled={busy}>
              Save local profile
            </button>
            {user && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void change({
                    type: "user.forget",
                    id: user.id,
                    revision: user.revision,
                  })
                }
              >
                Forget local profile
              </button>
            )}
          </div>
        </form>
      )}
      {status && <p role="status">{status}</p>}
      <section>
        <h2>Local data</h2>
        <p>
          Export a JSON copy of the local SQLite snapshot, or delete this
          computer's local academic workspace after an explicit confirmation.
          Provider keys and credentials are not part of the export.
        </p>
        <div className="actions">
          <button disabled={dataBusy} onClick={() => void exportLocalData()}>
            Export local data
          </button>
          <button
            disabled={dataBusy}
            onClick={() => void deleteLocalData()}
          >
            Delete local data
          </button>
        </div>
      </section>
    </section>
  );
}
