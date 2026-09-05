import { useEffect, useState } from "react";
export function ProviderSettings() {
  const [configured, setConfigured] = useState(false),
    [secure, setSecure] = useState(false),
    [key, setKey] = useState(""),
    [status, setStatus] = useState("");
  useEffect(() => {
    void window.desk
      .providerStatus()
      .then((s) => {
        setConfigured(s.configured);
        setSecure(s.secureStorage);
      })
      .catch(() => setStatus("Provider settings could not be loaded."));
  }, []);
  return (
    <section>
      <h2>AI connection</h2>
      <p>
        {configured
          ? "A provider key is saved on this computer. Live connection is verified when a request succeeds."
          : "Connect an OpenAI API key to use Lens assistance in this development build."}
      </p>
      <p className="muted">
        API usage is billed by the provider. Your key stays in secure local
        storage. Lens sends your question and context when you press Ask; a
        captured screen is shared only when you select that option.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void window.desk
            .saveProviderKey(key)
            .then(() => {
              setKey("");
              setConfigured(true);
              setStatus("Key saved securely.");
            })
            .catch(() =>
              setStatus(
                "Could not save this key. Check its format and secure storage.",
              ),
            );
        }}
      >
        <label>
          OpenAI API key
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            minLength={20}
            maxLength={500}
          />
        </label>
        <div className="actions">
          <button disabled={!secure || key.length < 20}>Save key</button>
          {configured && (
            <button
              type="button"
              onClick={() =>
                void window.desk.removeProviderKey().then(() => {
                  setConfigured(false);
                  setStatus("Provider disconnected.");
                })
              }
            >
              Disconnect provider
            </button>
          )}
        </div>
      </form>
      {!secure && <p>Secure storage is unavailable. A key cannot be saved.</p>}
      {status && <p role="status">{status}</p>}
    </section>
  );
}
