import { useState } from "react";
import type {
  PlanningPreferences,
  PlanningMode,
} from "../../../packages/domain/contracts";
import { userError } from "./errors";
export function PlanningSettings({
  preferences,
  mode,
  saveMode,
  save,
}: {
  preferences: PlanningPreferences;
  mode: PlanningMode;
  saveMode: (mode: PlanningMode) => Promise<unknown>;
  save: (input: PlanningPreferences) => Promise<unknown>;
}) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section>
      <h2>Planning behavior</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const mode = new FormData(e.currentTarget).get(
            "mode",
          ) as PlanningMode;
          setBusy(true);
          void saveMode(mode)
            .then(() => setStatus("Planning behavior saved."))
            .catch((e) => setStatus(userError(e)))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Planning mode
          <select
            aria-label="Planning mode"
            name="mode"
            key={mode}
            defaultValue={mode}
          >
            <option value="auto-plan">Auto-plan new work</option>
            <option value="suggest">Suggest</option>
          </select>
        </label>
        <p>
          Auto-plan reserves available time when you capture confirmed work. It
          keeps existing blocks in place. During an active study session, new
          work stays as proposals. Suggest leaves all new work as proposals.
          Switching modes does not change saved blocks.
        </p>
        <button disabled={busy}>Save planning behavior</button>
      </form>
      <h2>Study time</h2>
      <p>
        Use local time on this device. Today’s plan stays within this window and
        leaves breathing room.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setStatus("");
          void save({
            studyStart: String(f.get("start")),
            sleepCutoff: String(f.get("cutoff")),
            studyDays: f.getAll("days").map(Number),
            bufferPercent: Number(f.get("buffer")),
          })
            .then(() => setStatus("Study preferences saved."))
            .catch((e) => setStatus(userError(e)))
            .finally(() => setBusy(false));
        }}
      >
        <div className="fields">
          <label>
            Study starts at
            <input
              name="start"
              type="time"
              required
              defaultValue={preferences.studyStart}
            />
          </label>
          <label>
            Sleep cutoff
            <input
              name="cutoff"
              type="time"
              required
              defaultValue={preferences.sleepCutoff}
            />
          </label>
        </div>
        <fieldset className="study-days">
          <legend>Study days</legend>
          {[
            "Sunday",
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
          ].map((day, i) => (
            <label className="check" key={day}>
              <input
                type="checkbox"
                name="days"
                value={i}
                defaultChecked={preferences.studyDays.includes(i)}
              />
              {day}
            </label>
          ))}
        </fieldset>
        <label>
          Unscheduled buffer (%)
          <input
            type="number"
            name="buffer"
            min={5}
            max={50}
            required
            defaultValue={preferences.bufferPercent}
          />
        </label>
        <button disabled={busy}>Save study preferences</button>
        <p role="status">{status}</p>
      </form>
    </section>
  );
}
