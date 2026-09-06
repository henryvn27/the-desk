import { useEffect, useState } from "react";
import type {
  SupabaseAccountResult,
  SupabaseAccountStatus,
} from "../../../packages/integrations/supabase-auth";
import { userError } from "./errors";

const initial: SupabaseAccountStatus = {
  configured: false,
  authenticated: false,
  email: null,
  userId: null,
  secureStorage: false,
  source: null,
};

export function AccountSettings() {
  const [account, setAccount] = useState(initial);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void window.desk
      .accountStatus()
      .then(setAccount)
      .catch((error) => setStatus(userError(error)));
  }, []);

  async function change(action: () => Promise<SupabaseAccountResult>) {
    setBusy(true);
    setStatus("");
    try {
      const result = await action();
      setAccount(result);
      setStatus(result.message ?? "");
      if (!result.authenticated) setPassword("");
    } catch (error) {
      setStatus(userError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Desk account</h2>
      {!account.configured ? (
        <p>
          Cloud account access is not configured in this build. The local
          SQLite workspace remains available and no cloud sync is claimed.
        </p>
      ) : account.authenticated ? (
        <>
          <p>
            Signed in as <strong>{account.email ?? "Desk account"}</strong>.
            Account identity and school connections remain separate.
          </p>
          <button
            disabled={busy}
            onClick={() => void change(() => window.desk.accountSignOut())}
          >
            Sign out of Desk account
          </button>
        </>
      ) : (
        <>
          <p>
            Sign in to enable a future account-owned sync. Local SQLite remains
            authoritative on this computer.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void change(() => window.desk.accountSignIn(email, password));
            }}
          >
            <label>
              Account email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                minLength={8}
                required
              />
            </label>
            <div className="actions">
              <button className="primary" disabled={busy}>
                Sign in
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void change(() => window.desk.accountSignUp(email, password))
                }
              >
                Create account
              </button>
            </div>
          </form>
        </>
      )}
      {!account.secureStorage && account.configured && (
        <p className="attention">
          Secure local storage is unavailable; Desk will not save an account
          session on this computer.
        </p>
      )}
      {status && <p role="status">{status}</p>}
    </section>
  );
}
