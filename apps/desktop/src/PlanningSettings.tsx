import { useState } from "react";
import type { PlanningPreferences } from "../../../packages/domain/contracts";
import { userError } from "./errors";
export function PlanningSettings({
  preferences,
  save,
}: {
  preferences: PlanningPreferences;
  save: (input: PlanningPreferences) => Promise<unknown>;
}) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section>
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
