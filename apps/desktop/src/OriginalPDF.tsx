import { useState } from "react";
import type { Source } from "../../../packages/domain/contracts";
import { userError } from "./errors";
export function OriginalPDF({ source }: { source: Source }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <p>
        Original PDF preserved ·{" "}
        {Math.ceil((source.pdf?.byteLength ?? 0) / 1024)} KB
      </p>
      <button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void window.desk
            .exportPDF(source.id)
            .then((saved) =>
              setMessage(saved ? "Original PDF saved" : "Export canceled"),
            )
            .catch((error) => setMessage(userError(error)))
            .finally(() => setBusy(false));
        }}
      >
        Save original PDF
      </button>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
