import {
  connectionCapabilities,
  type ConnectionCapability,
  type ConnectionSurface,
  type ConnectionState,
} from "../../../packages/integrations/catalog";

const surfaceLabels: Record<ConnectionSurface, string> = {
  "full-sync": "Full sync",
  "browser-assisted": "Browser-assisted",
  "browser-context": "Browser context",
  "manual-fallback": "Manual fallback",
  experimental: "Experimental",
};

const stateLabels: Record<ConnectionState, string> = {
  available: "Available now",
  "not-connected": "Not connected",
  unavailable: "Unavailable",
};

function CapabilityCard({ capability }: { capability: ConnectionCapability }) {
  return (
    <article className="connection-card">
      <div className="connection-card-heading">
        <div>
          <div className="eyebrow">{surfaceLabels[capability.surface]}</div>
          <h3>{capability.name}</h3>
        </div>
        <span className={`connection-state ${capability.state}`}>
          {stateLabels[capability.state]}
        </span>
      </div>
      <p>{capability.summary}</p>
      <p className="muted">Fallback: {capability.fallback}</p>
    </article>
  );
}

export function ConnectionsSettings() {
  return (
    <section>
      <h2>Connections</h2>
      <p>
        This is the connection ladder Desk understands. It reports the current
        capability instead of treating an OAuth screen or a saved URL as sync.
        Nothing here bypasses school administrator restrictions.
      </p>
      <div className="connection-grid">
        {connectionCapabilities().map((capability) => (
          <CapabilityCard capability={capability} key={capability.id} />
        ))}
      </div>
      <p className="muted">
        Local capture, saved HTTPS resources, and the SQLite study workspace
        continue to work without an external account.
      </p>
    </section>
  );
}
