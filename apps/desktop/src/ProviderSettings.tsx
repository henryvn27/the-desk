import { useEffect, useState } from "react";
import type { AIProviderMode, AIProviderStatus } from "../../../packages/intelligence/ai-provider";
import { userError } from "./errors";

const initialStatus: AIProviderStatus = {
  selectedProvider: "desk-managed",
  availableProviders: [],
  availability: "offline",
  providerLabel: "Desk Managed",
  configured: false,
  secureStorage: false,
  source: null,
  capabilities: { text: false, image: false, structuredOutput: false },
  message: "Checking Desk AI…",
};

export function ProviderSettings() {
  const [connection, setConnection] = useState<AIProviderStatus>(initialStatus);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      setConnection(await window.desk.providerStatus());
    } catch {
      setStatus("AI provider status could not be loaded.");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function run(action: () => Promise<AIProviderStatus | unknown>) {
    setBusy(true);
    setStatus("");
    try {
      const result = await action();
      if (result && typeof result === "object" && "selectedProvider" in result)
        setConnection(result as AIProviderStatus);
      else await refresh();
    } catch (error) {
      const message = userError(error);
      setStatus(
        message === "The Codex runtime is not available."
          ? "ChatGPT/Codex is unavailable on this Mac. Use Desk Managed or configure BYOK."
          : message || "The provider action could not be completed.",
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  function select(mode: AIProviderMode) {
    return run(() => window.desk.selectProvider(mode));
  }

  const active = connection.selectedProvider;
  const ready = connection.availability === "ready";
  const available = (mode: AIProviderMode) => connection.availableProviders.includes(mode);
  const managedAvailable = available("desk-managed");
  const accountLine = connection.account
    ? [connection.account.plan, connection.account.label].filter(Boolean).join(" · ")
    : "";

  return (
    <section className="provider-settings" aria-labelledby="ai-provider-heading">
      <h2 id="ai-provider-heading">AI</h2>
      <p className="muted">
        {managedAvailable
          ? "Choose how The Desk powers interactive help. Desk Managed is ready by default."
          : "Choose how The Desk powers interactive help. This build has no managed AI connection yet; you can connect another provider below."}
      </p>
      <div className="settings-list" role="list">
        <ProviderRow
          title="Desk Managed"
          detail={managedAvailable ? "Built in. No setup required." : "Managed AI is not connected in this build."}
          note="Recommended"
          active={active === "desk-managed"}
          ready={active === "desk-managed" && ready}
          action={active === "desk-managed" || !available("desk-managed") ? undefined : { label: "Use Desk Managed", onClick: () => void select("desk-managed") }}
          disabled={busy}
        />
        <ProviderRow
          title="ChatGPT / Codex"
          detail={accountLine || "Use the Codex access from your ChatGPT account."}
          active={active === "chatgpt-codex"}
          ready={active === "chatgpt-codex" && ready}
          action={
            ready && active === "chatgpt-codex"
              ? { label: "Disconnect", onClick: () => void run(() => window.desk.disconnectChatGPT()) }
              : available("chatgpt-codex") && active !== "chatgpt-codex"
                ? { label: "Use ChatGPT", onClick: () => void select("chatgpt-codex") }
                : { label: "Connect ChatGPT", onClick: () => void run(() => window.desk.connectChatGPT()) }
          }
          disabled={busy}
        />
        <ProviderRow
          title="Bring Your Own Key"
          detail={active === "byok" && connection.configured ? "Your configured provider account." : "Use your own supported API credentials."}
          active={active === "byok"}
          ready={active === "byok" && ready}
          action={
            active === "byok" && connection.configured
              ? { label: "Disconnect", onClick: () => void run(async () => { await window.desk.removeProviderKey(); return window.desk.providerStatus(); }) }
              : available("byok") && active !== "byok"
                ? { label: "Use BYOK", onClick: () => void select("byok") }
                : { label: "Configure", onClick: () => void run(async () => { const imported = await window.desk.importProviderKey(); if (imported) setStatus("Key stored securely on this Mac."); return window.desk.providerStatus(); }) }
          }
          disabled={busy || (active === "byok" && !connection.secureStorage)}
        />
      </div>
      {active === "chatgpt-codex" && connection.limits?.length ? (
        <div className="provider-limits" aria-label="Codex usage limits">
          {connection.limits.map((limit) => (
            <div key={limit.id} className="provider-limit">
              <span>{limit.label}</span>
              <span>{limit.usedPercent === null ? "Usage unavailable" : `${Math.round(limit.usedPercent)}% used`}</span>
            </div>
          ))}
        </div>
      ) : null}
      <p className={ready ? "muted" : "muted provider-status-message"} role="status">
        {connection.message}
      </p>
      {status && <p role="status">{status}</p>}
      {active === "byok" && !connection.secureStorage && <p>Secure local storage is unavailable. A user key cannot be saved.</p>}
    </section>
  );
}

function ProviderRow({
  title,
  detail,
  active,
  ready,
  note,
  action,
  disabled,
}: {
  title: string;
  detail: string;
  active: boolean;
  ready: boolean;
  note?: string;
  action?: { label: string; onClick: () => void };
  disabled: boolean;
}) {
  return (
    <div className={`provider-row${active ? " provider-row-active" : ""}`} role="listitem">
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
        {(note || active) && <small>{[note, active ? ready ? "Selected" : "Selected · needs attention" : ""].filter(Boolean).join(" · ")}</small>}
      </div>
      {action && <button type="button" disabled={disabled} onClick={action.onClick}>{action.label}</button>}
    </div>
  );
}
