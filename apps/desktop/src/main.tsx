import { userError } from "./errors";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  DeskAPI,
  Snapshot,
  Command,
} from "../../../packages/domain/contracts";
import { plan } from "../../../packages/planner";
import "./style.css";
import { Capture } from "./Capture";
import { ProviderSettings } from "./ProviderSettings";
import { Lens } from "./Lens";
declare global {
  interface Window {
    desk: DeskAPI;
  }
}
const empty: Snapshot = { classes: [], tasks: [], sessions: [] };
function App() {
  const [data, setData] = useState(empty),
    [page, setPage] = useState("Home"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [capture, setCapture] = useState(false),
    [lastId, setLastId] = useState(""),
    [tick, setTick] = useState(Date.now());
  const kind = location.hash.slice(1);
  const active = data.sessions.find((s) => !s.endedAt);
  const activeTask = data.tasks.find((t) => t.id === active?.taskId);
  useEffect(() => {
    const refresh = () =>
      window.desk
        .snapshot()
        .then(setData)
        .catch((e) => setError(userError(e)));
    void refresh();
    const timer = setInterval(() => {
      setTick(Date.now());
      void refresh();
    }, 2000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setCapture(false);
        if (kind === "lens") void window.desk.dismiss();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPage("Library");
        document.querySelector<HTMLInputElement>("#search")?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [kind]);
  async function act(c: Command) {
    setBusy(true);
    setError("");
    try {
      const next = await window.desk.command(c);
      setData(next);
      return next;
    } catch (e) {
      setError(userError(e));
    } finally {
      setBusy(false);
    }
  }
  async function open(id: string) {
    try {
      await window.desk.openResource(id);
    } catch (e) {
      setError(userError(e));
    }
  }
  const start = new Date(tick);
  const cutoff = new Date(tick);
  cutoff.setHours(22, 0, 0, 0);
  if (cutoff < start) cutoff.setTime(+start);
  const schedule = plan(data.tasks, start, cutoff);
  const next = data.tasks.find((t) => t.id === schedule.blocks[0]?.taskId);
  const elapsed = active
    ? Math.max(
        0,
        ((active.pausedAt ? Date.parse(active.pausedAt) : tick) -
          Date.parse(active.startedAt) -
          active.pausedMs) /
          60000,
      )
    : 0;
  const sessionPanel = (
    <section className="session">
      <div className="eyebrow">
        {activeTask
          ? data.classes.find((c) => c.id === activeTask.classId)?.name
          : "Study session"}
      </div>
      <h2>{activeTask?.title ?? "No active session"}</h2>
      {active && (
        <>
          <p>
            {Math.floor(elapsed)} min · {active.pausedAt ? "Paused" : "Working"}
          </p>
          <div className="actions">
            <button
              onClick={() =>
                void act({
                  type: active.pausedAt ? "session.resume" : "session.pause",
                })
              }
            >
              {active.pausedAt ? "Resume" : "Pause"}
            </button>
            <button onClick={() => void window.desk.lens()}>Lens</button>
            {activeTask?.resource && (
              <button onClick={() => void open(activeTask.id)}>Resource</button>
            )}
          </div>
          <div className="actions">
            <button
              disabled={busy}
              onClick={() =>
                void act({ type: "session.end", completed: false })
              }
            >
              End · keep unfinished
            </button>
            <button
              disabled={busy}
              className="primary"
              onClick={() => void act({ type: "session.end", completed: true })}
            >
              Finish task
            </button>
          </div>
        </>
      )}
    </section>
  );
  if (kind === "lens")
    return (
      <Lens
        title={activeTask?.title ?? "No active study context"}
        className={
          data.classes.find((c) => c.id === activeTask?.classId)?.name ?? ""
        }
      />
    );
  if (kind === "controller")
    return (
      <main className="controller">
        {error && <p role="alert">{error}</p>}
        {sessionPanel}
      </main>
    );
  return (
    <div className="shell">
      <aside>
        <div className="brand">The Desk</div>
        <nav aria-label="Main">
          {["Home", "Plan", "Library"].map((p) => (
            <button
              key={p}
              aria-current={page === p ? "page" : undefined}
              onClick={() => setPage(p)}
            >
              {p}
            </button>
          ))}
        </nav>
        <div className="eyebrow">Classes</div>
        {data.classes.map((c) => (
          <button
            className="class-link"
            key={c.id}
            onClick={() => setPage(c.id)}
          >
            <span className="dot" />
            {c.name}
          </button>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = e.currentTarget;
            const name = new FormData(f).get("name") as string;
            void act({ type: "class.create", name }).then((s) => {
              if (s) f.reset();
            });
          }}
        >
          <label className="sr-only" htmlFor="class">
            Class name
          </label>
          <input
            id="class"
            name="name"
            placeholder="Add a class…"
            required
            maxLength={100}
          />
          <button disabled={busy} type="submit">
            Add class
          </button>
        </form>
        <div className="sidebar-bottom">
          <button onClick={() => setCapture(true)}>＋ Capture</button>
          <button onClick={() => setPage("Settings")}>Settings</button>
          <small>Saved on this Mac</small>
        </div>
      </aside>
      <main>
        <header>
          <div className="eyebrow">
            {new Date(tick).toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </div>
          <button onClick={() => setCapture(true)}>Capture</button>
        </header>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {lastId && (
          <p role="status">
            Task saved.{" "}
            <button
              onClick={() =>
                void act({ type: "task.undo", id: lastId }).then((s) => {
                  if (s) setLastId("");
                })
              }
            >
              Undo capture
            </button>
          </p>
        )}
        {page === "Home" ? (
          <>
            <h1>Make room for focus.</h1>
            {active ? (
              sessionPanel
            ) : next ? (
              <section className="next">
                <div className="eyebrow">
                  Next · {data.classes.find((c) => c.id === next.classId)?.name}
                </div>
                <h2>{next.title}</h2>
                <p>
                  {schedule.blocks[0]?.minutes} minutes
                  {next.resource ? " · Resource ready" : ""}
                </p>
                <details>
                  <summary>Why this?</summary>
                  <p>{schedule.blocks[0]?.why}</p>
                </details>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void act({ type: "session.start", taskId: next.id }).then(
                      (s) => {
                        if (s) {
                          setLastId("");
                          if (next.resource) void open(next.id);
                        }
                      },
                    )
                  }
                >
                  Start session →
                </button>
              </section>
            ) : (
              <section className="next">
                <h2>
                  {data.classes.length
                    ? "Ready when you are."
                    : "A place for your schoolwork."}
                </h2>
                <p>
                  {data.classes.length
                    ? "Capture an assignment to plan your next session."
                    : "Add your first class, then capture an assignment."}
                </p>
                <button onClick={() => setCapture(true)}>
                  Capture assignment
                </button>
              </section>
            )}
            <h2 className="section-title">Today</h2>
            {schedule.blocks.slice(1).map((b) => (
              <div className="row" key={b.taskId}>
                <span>{data.tasks.find((t) => t.id === b.taskId)?.title}</span>
                <span>{b.minutes} min</span>
              </div>
            ))}
            {!schedule.blocks.slice(1).length && (
              <p className="muted">No other blocks planned.</p>
            )}
            {schedule.unscheduled.length > 0 && (
              <>
                <h2 className="section-title">Needs attention</h2>
                {schedule.overloadMinutes > 0 && (
                  <p>
                    {schedule.overloadMinutes} minutes of required work cannot
                    fit before the current cutoff.
                  </p>
                )}
                {schedule.unscheduled.map((u) => (
                  <div className="attention" key={u.taskId}>
                    <strong>
                      {data.tasks.find((t) => t.id === u.taskId)?.title}
                    </strong>
                    <p>{u.reason}</p>
                  </div>
                ))}
              </>
            )}
          </>
        ) : page === "Plan" ? (
          <>
            <h1>Your plan</h1>
            <p className="muted">Today until 10 PM · 15% breathing room</p>
            {schedule.blocks.map((b) => (
              <section className="row" key={b.taskId}>
                <div>
                  <strong>
                    {data.tasks.find((t) => t.id === b.taskId)?.title}
                  </strong>
                  <p>
                    {new Date(b.start).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}{" "}
                    · {b.minutes} minutes
                  </p>
                  <small>{b.why}</small>
                </div>
              </section>
            ))}
          </>
        ) : page === "Settings" ? (
          <>
            <h1>Settings</h1>
            <ProviderSettings />
            <h2>Connections</h2>
            <p>
              Cloud sync is not connected. Changes are saved locally; remote
              synchronization is not yet available.
            </p>
            <h2>Lens</h2>
            <p>
              Option/Alt + Space opens Lens. This build supports a local
              selection overlay and explicit screen capture. Connect an AI provider above for typed assistance. Voice is not available yet.
            </p>
          </>
        ) : (
          <Library
            data={data}
            classId={data.classes.some((c) => c.id === page) ? page : undefined}
            open={open}
          />
        )}
      </main>
      {capture && (
        <Capture
          classes={data.classes}
          busy={busy}
          onClose={() => setCapture(false)}
          onSave={async (input) => {
            const next = await act({ type: "task.create", input });
            if (next) {
              setLastId(next.tasks.at(-1)!.id);
              return true;
            }
            return false;
          }}
        />
      )}
    </div>
  );
}
function Library({
  data,
  classId,
  open,
}: {
  data: Snapshot;
  classId?: string;
  open: (id: string) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  return (
    <>
      <h1>{data.classes.find((c) => c.id === classId)?.name ?? "Library"}</h1>
      <label htmlFor="search">Search tasks and notes</label>
      <input
        id="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {data.tasks
        .filter(
          (t) =>
            (!classId || t.classId === classId) &&
            `${t.title} ${t.notes}`
              .toLowerCase()
              .includes(search.toLowerCase()),
        )
        .map((t) => (
          <article className="row" key={t.id}>
            <div>
              <h2>{t.title}</h2>
              <p>
                {t.completed
                  ? "Completed · submission and understanding not assessed"
                  : t.deadlineConfirmed
                    ? "Deadline confirmed"
                    : "Deadline needs confirmation"}
              </p>
              {t.notes && <p>{t.notes}</p>}
              {t.resource && (
                <button onClick={() => void open(t.id)}>Open resource</button>
              )}
            </div>
            <span>{t.minutes} min</span>
          </article>
        ))}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
