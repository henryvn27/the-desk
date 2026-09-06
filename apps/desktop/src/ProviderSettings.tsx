import { useEffect, useState } from "react";
import type { DeskAPI } from "../../../packages/domain/contracts";
export function ProviderSettings() {
  const [connection, setConnection] = useState<
    Awaited<ReturnType<DeskAPI["providerStatus"]>>
  >({ configured: false, secureStorage: false, source: null });
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void window.desk
      .providerStatus()
      .then(setConnection)
      .catch(() => setStatus("Provider settings could not be loaded."));
  }, []);
  async function change(action: () => Promise<unknown>) {
    setBusy(true);
    setStatus("");
    try {
      await action();
      setConnection(await window.desk.providerStatus());
    } catch {
      setStatus(
        "The connection could not be changed. Check the key file and secure local storage.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h2>AI connection · OpenRouter</h2>
      <p>
        {connection.source === "development-env"
          ? "This development session uses the locally configured OpenRouter key. Packaged apps do not load it."
          : connection.configured
            ? "An OpenRouter user key is saved on this computer. A successful request verifies the live connection."
            : "Import your OpenRouter key from a text file or an environment file containing OPENROUTER_API_KEY."}
      </p>
      <p className="muted">
        The native file picker reads the key into secure local storage. It is
        never returned to this interface. API usage is billed to your OpenRouter
        account.
      </p>
      <p>
        Desk chooses approved models and endpoints. Requests require zero data
        retention and deny provider data collection. OpenRouter account-level
        logging settings still apply.
      </p>
      <p className="muted">
        Lens sends your question and session context when you press Ask. A
        captured screen is shared only when you select that option.
      </p>
      {connection.source !== "development-env" && (
        <div className="actions">
          <button
            disabled={busy || !connection.secureStorage}
            onClick={() =>
              void change(async () => {
                if (await window.desk.importProviderKey())
                  setStatus("OpenRouter key imported securely.");
              })
            }
          >
            Import OpenRouter key
          </button>
          {connection.configured && (
            <button
              disabled={busy}
              onClick={() =>
                void change(async () => {
                  await window.desk.removeProviderKey();
                  setStatus("OpenRouter disconnected.");
                })
              }
            >
              Disconnect provider
            </button>
          )}
        </div>
      )}
      {!connection.secureStorage && (
        <p>Secure storage is unavailable. A user key cannot be saved.</p>
      )}
      {status && <p role="status">{status}</p>}
    </section>
  );
}
