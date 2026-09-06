import { useEffect, useState } from "react";

type BridgeStatus = Awaited<ReturnType<typeof window.desk.browserBridgeStatus>>;

export function BrowserBridgeSettings() {
  const [status, setStatus] = useState<BridgeStatus>();
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    void window.desk
      .browserBridgeStatus()
      .then((next) => {
        if (active) setStatus(next);
      })
      .catch((error) => {
        if (active)
          setMessage(error instanceof Error ? error.message : "Bridge status unavailable.");
      });
    return () => {
      active = false;
    };
  }, []);
  async function copyToken() {
    if (!status?.token) return;
    try {
      await navigator.clipboard.writeText(status.token);
      setMessage("Pairing token copied. Keep it on this Mac.");
    } catch {
      setMessage("Copy is unavailable. Select the token to copy it manually.");
    }
  }
  return (
    <section>
      <h2>Browser bridge</h2>
      <p>
        The optional Chrome/Edge bridge sends only the current page title, URL,
        selection, and bounded visible text to this Mac. It never receives your
        provider key or runs page commands.
      </p>
      {status?.running ? (
        <div className="source">
          <p>
            <strong>Desktop host ready.</strong> In the Desk extension settings,
            enter this endpoint and pairing token.
          </p>
          <p>
            <span className="muted">Endpoint</span>
            <br />
            <code>{status.endpoint}</code>
          </p>
          <p>
            <span className="muted">Pairing token</span>
            <br />
            <code>{status.token}</code>
          </p>
          <button type="button" onClick={() => void copyToken()}>
            Copy pairing token
          </button>
        </div>
      ) : (
        <p className="muted">The local browser host is unavailable in this run.</p>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
