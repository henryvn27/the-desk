import { useState } from "react";
import type { CapturePolicy } from "../../../packages/domain/contracts";
import { userError } from "./errors";
export function CapturePolicySettings({
  mode,
  save,
}: {
  mode: CapturePolicy;
  save: (mode: CapturePolicy) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  return (
    <section>
      <h2>Capture confidence</h2>
      <label>
        Capture mode
        <select
          aria-label="Capture mode"
          value={mode}
          disabled={busy}
          onChange={async (e) => {
            setBusy(true);
            setStatus("");
            try {
              await save(e.target.value as CapturePolicy);
              setStatus(
                "Capture policy saved. Existing Inbox items stay for review.",
              );
            } catch (e) {
              setStatus(userError(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <option value="conservative">Conservative</option>
          <option value="balanced">Balanced</option>
          <option value="autopilot">Autopilot</option>
        </select>
      </label>
      <p>
        {mode === "conservative"
          ? "Every pasted capture goes to Inbox for review."
          : mode === "balanced"
            ? "Complete, high-confidence pasted assignments can file automatically. Everything else stays in Inbox."
            : "Complete pasted assignments may also use a unique partial class-name match. Ambiguous or incomplete captures still require review."}
      </p>
      <p className="muted">
        Automatic filing requires a future deadline with an explicit time zone
        and a stated duration. Possible duplicates, assessments and multiple
        resource links need review. Filing follows your planning mode. Each
        filing appears in Inbox history and can be undone until further work
        changes it.
      </p>
      {status && <p role="status">{status}</p>}
    </section>
  );
}
