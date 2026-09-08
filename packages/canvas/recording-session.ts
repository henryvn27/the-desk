export type RecordingSessionLease = {
  id: string;
  isCurrent: () => boolean;
  release: () => boolean;
};

type ActiveRecordingSession = {
  id: string;
  token: symbol;
  cleanup: () => void;
};

/** Owns one recording's resources so stale React cleanups cannot stop a newer session. */
export class RecordingSessionRegistry {
  private active: ActiveRecordingSession | undefined;

  hasActive(): boolean {
    return this.active !== undefined;
  }

  begin(id: string, cleanup: () => void): RecordingSessionLease {
    if (this.active) throw Error("A recording session is already active.");
    const token = Symbol(id);
    this.active = { id, token, cleanup };
    let released = false;
    const isCurrent = () => !released && this.active?.token === token;
    const release = () => {
      if (released) return false;
      released = true;
      if (this.active?.token !== token) return false;
      this.active = undefined;
      return true;
    };
    return { id, isCurrent, release };
  }

  /** Dispose the current session during unmount or an explicit owner teardown. */
  disposeCurrent(): void {
    const current = this.active;
    if (!current) return;
    this.active = undefined;
    current.cleanup();
  }
}
