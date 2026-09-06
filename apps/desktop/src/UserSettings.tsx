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
}: {
  user: User | null;
  save: (command: Command) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(user !== null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
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
    </section>
  );
}
