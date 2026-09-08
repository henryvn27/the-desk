import { learningSessions } from "../../../packages/learning/memory";
import { Memory } from "./Memory";
import { Mistakes } from "./Mistakes";
import { Concepts } from "./Concepts";
import { Attempts } from "./Attempts";
import { Assessments } from "./Assessments";
import { Evidence } from "./Evidence";
import { Authority } from "./Authority";
import { Teachers } from "./Teachers";
import { Units } from "./Units";
import { AcademicContext } from "./AcademicContext";
import { UserSettings } from "./UserSettings";
import { CapturePolicySettings } from "./CapturePolicySettings";
import { CaptureInbox } from "./CaptureInbox";
import type { CaptureInboxItem } from "../../../packages/domain/contracts";
import { userError } from "./errors";
import { resolveTimeZone } from "../../../packages/domain/time-zone";
import React, { useEffect, useMemo, useState } from "react";
const Canvas = React.lazy(() => import("./Canvas"));
import { createRoot } from "react-dom/client";
import type {
  DeskAPI,
  Snapshot,
  Command,
  Task,
  SearchResult,
  CanvasRecord,
  LensHotkeyStatus,
} from "../../../packages/domain/contracts";
import type { DeskIntelligence } from "../../../packages/intelligence/desk-intelligence";
import type { DeskSyncStatus } from "../../../packages/integrations/supabase-sync";
import { deriveHome } from "../../../packages/planner/home";
import { defaultPlanningPreferences } from "../../../packages/domain/contracts";
import { StudyPlan } from "./StudyPlan";
import { PlanningSettings } from "./PlanningSettings";
import { ClassOverview } from "./ClassOverview";
import { Sources } from "./Sources";
import SourceReader from "./SourceReader";
import "./style.css";
import "./styles/design-system.css";
import { Capture } from "./Capture";
import { ProviderSettings } from "./ProviderSettings";
import { AccountSettings } from "./AccountSettings";
import { ConnectionsSettings } from "./ConnectionsSettings";
import { SyncSettings } from "./SyncSettings";
import { Lens } from "./Lens";
import { SessionCorrection } from "./SessionCorrection";
import { TaskChecklist } from "./TaskChecklist";
import { SessionKit } from "./SessionKit";
import { SessionReview } from "./SessionReview";
import { TestOutPanel } from "./TestOutPanel";
import { BrowserBridgeSettings } from "./BrowserBridgeSettings";
import { ChatWorkspace, type ChatThread } from "./ChatWorkspace";
import { Button, Input } from "./components/base";
import {
  BookOpen01,
  Calendar,
  FilePlus02,
  Home01,
  MessageChatCircle,
  SearchMd,
  Settings01,
} from "@untitledui/icons";
import type { ChatAction } from "../../../packages/intelligence/chat";
import type { BrowserBridgeMessage } from "../../../packages/integrations/browser-bridge";
import type { TestOutPlan } from "../../../packages/intelligence/learning-loop";
import { learningOverrideText } from "../../../packages/intelligence/learning-loop";
type CanvasTarget = CanvasRecord & { initialBlockId?: string };
declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH: string;
    desk: DeskAPI;
  }
}
window.EXCALIDRAW_ASSET_PATH = location.origin + "/";
const empty: Snapshot = {
  user: null,
  mistakes: [],
  memories: [],
  inference: { enabled: true, excludedSessionIds: [] },
  tutoringMode: "balanced",
  capturePolicy: "balanced",
  captureInbox: [],
  planningMode: "auto-plan",
  gradeCategories: [],
  gradeEntries: [],
  assessments: [],
  academicPeriods: [],
  spaces: [],
  tracks: [],
  units: [],
  teachers: [],
  teacherEvidence: [],
  authorityClaims: [],
  authorityResolutions: [],
  concepts: [],
  attempts: [],
  plans: [],
  planChanges: [],
  outbox: [],
  syncConflicts: [],
  studyBlocks: [],
  canvases: [],
  sources: [],
  classes: [],
  tasks: [],
  sessions: [],
  planning: defaultPlanningPreferences,
};
const emptySync: DeskSyncStatus = {
  configured: false,
  authenticated: false,
  phase: "disabled",
  queued: 0,
  unresolvedConflicts: 0,
  lastSyncedAt: null,
  lastError: null,
  uploaded: 0,
};
function App() {
  const [data, setData] = useState(empty),
    [page, setPage] = useState("Chat"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [capture, setCapture] = useState(false),
    [lastId, setLastId] = useState(""),
    [tick, setTick] = useState(Date.now());
  const [intelligence, setIntelligence] = useState<DeskIntelligence>();
  const [testOutPlan, setTestOutPlan] = useState<TestOutPlan>();
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [workspaceAttempt, setWorkspaceAttempt] = useState(0);
  const [captureNotice, setCaptureNotice] = useState("");
  const [captureText, setCaptureText] = useState("");
  const [planRepairRequested, setPlanRepairRequested] = useState(false);
  const [syncStatus, setSyncStatus] = useState(emptySync);
  const [focusSearch, setFocusSearch] = useState(false);
  const [editing, setEditing] = useState<Task>();
  const [reviewingCapture, setReviewingCapture] = useState<CaptureInboxItem>();
  const [canvas, setCanvas] = useState<CanvasTarget>();
  const [browserContext, setBrowserContext] =
    useState<BrowserBridgeMessage | null>(null);
  const [chatThreads, setChatThreads] = useState<ChatThread[]>([]);
  const [activeChatThreadId, setActiveChatThreadId] = useState<string | null>(null);
  const [providerConfigured, setProviderConfigured] = useState<boolean | null>(null);
  const [lensHotkeyStatus, setLensHotkeyStatus] = useState<LensHotkeyStatus>({
    available: false,
    source: "unavailable",
    message: "Lens shortcut is starting…",
  });
  useEffect(() => {
    void window.desk.lensHotkeyStatus().then(setLensHotkeyStatus).catch(() => undefined);
    const timer = window.setInterval(() => {
      void window.desk.lensHotkeyStatus().then(setLensHotkeyStatus).catch(() => undefined);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    let active = true;
    const refresh = () =>
      void window.desk
        .syncStatus()
        .then((next) => {
          if (active) setSyncStatus(next);
        })
        .catch(() => undefined);
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    let mounted = true;
    void window.desk
      .providerStatus()
      .then((status) => {
        if (mounted) setProviderConfigured(status.configured);
      })
      .catch(() => {
        if (mounted) setProviderConfigured(false);
      });
    return () => {
      mounted = false;
    };
  }, []);
  async function openCanvas(taskId: string | null, canvasId?: string, blockId?: string) {
    try {
      // Search deep-links carry the canonical canvas id. Read it directly so
      // a just-created or just-updated Note cannot be missed by the React
      // snapshot refresh cadence and accidentally forked into a blank canvas.
      if (canvasId) {
        const direct = await window.desk.canvas(canvasId);
        if (taskId && direct.taskId !== taskId) throw Error("That Note is linked to a different task.");
        setCanvas(blockId ? { ...direct, initialBlockId: blockId } : direct);
        return;
      }
      const existing = taskId ? data.canvases.find((c) => c.taskId === taskId) : undefined;
      const id =
        existing?.id ??
        (await act({ type: "canvas.create", taskId }, true))?.canvases.at(-1)
          ?.id;
      if (id) {
        const record = await window.desk.canvas(id);
        setCanvas(blockId ? { ...record, initialBlockId: blockId } : record);
      }
    } catch (e) {
      setError(userError(e));
    }
  }
  async function newNotebook(taskId: string | null, classId?: string | null) {
    try {
      const created = await act(
        { type: "canvas.create", taskId, classId, notebook: true },
        true,
      );
      const id = created?.canvases.at(-1)?.id;
      if (id) setCanvas(await window.desk.canvas(id));
    } catch (e) {
      setError(userError(e));
    }
  }
  useEffect(
    () =>
      window.desk.onEdit((action) => {
        const target = document.activeElement;
        const writable =
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          (target instanceof HTMLElement && target.isContentEditable);
        if (canvas && !writable && !document.querySelector("dialog[open]")) {
          // The engine exposes undo/redo through its accessible toolbar, not its
          // imperative API. Keep this adapter-specific mapping inside the renderer.
          document
            .querySelector<HTMLButtonElement>(
              `.canvas-engine button[aria-label="${action === "undo" ? "Undo" : "Redo"}"]`,
            )
            ?.click();
        } else if (writable) {
          document.execCommand(action);
        }
      }),
    [canvas],
  );
  const kind = location.hash.slice(1);
  const active = data.sessions.find((s) => !s.endedAt);
  const activeTask = data.tasks.find((t) => t.id === active?.taskId);
  const captureContextClassId = data.classes.some((c) => c.id === page)
    ? page
    : activeTask?.classId;
  const unreviewed = [...data.sessions]
    .reverse()
    .find((s) => s.endedAt && s.completionReported !== undefined && !s.review);
  const reviewTask = data.tasks.find((t) => t.id === unreviewed?.taskId);
  useEffect(() => {
    let active = true;
    let request = 0;
    const refresh = async () => {
      const current = ++request;
      try {
        const next = await window.desk.snapshot();
        let interpretation: DeskIntelligence | undefined;
        try {
          interpretation = await window.desk.intelligence();
        } catch {
          // The workspace stays usable if the derived interpretation is
          // temporarily unavailable; Home falls back to its planner projection.
        }
        if (!active || current !== request) return;
        setData(next);
        if (interpretation) setIntelligence(interpretation);
        setWorkspaceReady(true);
        setWorkspaceError("");
      } catch (e) {
        if (!active || current !== request) return;
        setWorkspaceError(userError(e));
      }
    };
    void refresh();
    const refreshTimer = setInterval(() => {
      void refresh();
    }, 2000);
    const clockTimer = setInterval(() => {
      setTick(Date.now());
    }, 1000);
    return () => {
      active = false;
      clearInterval(refreshTimer);
      clearInterval(clockTimer);
    };
  }, [workspaceAttempt]);
  useEffect(() => {
    // A compact controller can end a session while the main window is on Chat.
    // Surface the canonical review on Home once the shared snapshot reports it.
    if (page === "Chat" && !active && unreviewed && reviewTask) {
      setPage("Home");
    }
  }, [page, active?.id, unreviewed?.id, reviewTask?.id]);
  useEffect(() => {
    let active = true;
    void window.desk
      .browserContext()
      .then((context) => {
        if (active) setBrowserContext(context);
      })
      .catch(() => undefined);
    const unsubscribe = window.desk.onBrowserContext((context) => {
      if (active) setBrowserContext(context);
    });
    const unsubscribeClear = window.desk.onBrowserContextCleared(() => {
      if (active) setBrowserContext(null);
    });
    return () => {
      active = false;
      unsubscribe();
      unsubscribeClear();
    };
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setCapture(false);
        setCaptureText("");
        if (kind === "lens") void window.desk.dismiss();
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === "Space") {
        e.preventDefault();
        setCaptureText("");
        setCapture(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPage("Library");
        setFocusSearch(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [kind]);
  useEffect(() => {
    if (!focusSearch || page !== "Library") return;
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>("#search")?.focus();
      setFocusSearch(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusSearch, page]);
  async function act(c: Command, reportToCaller = false) {
    setBusy(true);
    setError("");
    try {
      const next = await window.desk.command(c);
      setData(next);
      void window.desk.intelligence().then(setIntelligence).catch(() => undefined);
      return next;
    } catch (e) {
      if (reportToCaller) throw e;
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
  const home = useMemo(() => deriveHome(data, new Date(tick)), [data, tick]);
  const week = home.plan;
  const plannedNext = home.next ? data.tasks.find((t) => t.id === home.next!.taskId) : undefined;
  const sharedNextAction = intelligence?.nextAction.kind === "start-task" ? intelligence.nextAction : undefined;
  const sharedObjective = intelligence?.nextAction.kind === "study-objective" ? intelligence.nextAction : undefined;
  const bestAction = intelligence?.nextBestAction;
  const next = sharedNextAction?.taskId
    ? data.tasks.find((task) => task.id === sharedNextAction.taskId) ?? plannedNext
    : plannedNext;
  const learningTask = bestAction?.taskId
    ? data.tasks.find((task) => task.id === bestAction.taskId)
    : undefined;
  const homeClassRows = useMemo(() => data.classes.map((course) => {
    const openTasks = data.tasks
      .filter((task) => task.classId === course.id && !task.completed)
      .sort((a, b) => (Date.parse(a.dueAt ?? "") || Infinity) - (Date.parse(b.dueAt ?? "") || Infinity));
    const first = openTasks[0];
    return { course, first, count: openTasks.length };
  }), [data.classes, data.tasks]);
  const startNext = React.useCallback(() => {
    if (!next || active || busy) return;
    void act({ type: "session.start", taskId: next.id }).then((state) => {
      if (state) {
        setLastId("");
        if (next.resource) void open(next.id);
      }
    });
  }, [active, busy, next]);
  const startLearning = React.useCallback(() => {
    if (!learningTask || active || busy) return;
    void act({ type: "session.start", taskId: learningTask.id }).then((state) => {
      if (state) {
        setLastId("");
        if (learningTask.resource) void open(learningTask.id);
      }
    });
  }, [active, busy, learningTask]);
  function runChatAction(action: ChatAction) {
    if (action.type === "resume-session") {
      void window.desk.focusController();
      return;
    }
    if (action.type === "start-session") {
      if (active || busy) {
        if (active) void window.desk.focusController();
        return;
      }
      const task = data.tasks.find((candidate) => candidate.id === action.taskId);
      void act({ type: "session.start", taskId: action.taskId }).then((state) => {
        if (state && task?.resource) void open(task.id);
      });
      return;
    }
    if (action.type === "open-notes") {
      void openCanvas(action.taskId);
      return;
    }
    if (action.page === "Capture") {
      setCapture(true);
      return;
    }
    setPage(action.page);
  }
  function createChatThread() {
    const id = crypto.randomUUID();
    setChatThreads((threads) => [
      ...threads,
      { id, title: "New chat", messages: [], updatedAt: new Date().toISOString() },
    ]);
    setActiveChatThreadId(id);
    setPage("Chat");
  }
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (page !== "Home" || (!next && !learningTask) || active || busy) return;
      if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter") return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)) return;
      event.preventDefault();
      if (next) startNext();
      else startLearning();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active, busy, learningTask, next, page, startLearning, startNext]);
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
          {activeTask?.checklist?.some((item) => !item.archived) && (
            <p className="session-progress">
              {
                activeTask.checklist.filter(
                  (item) => !item.archived && item.completed,
                ).length
              }{" "}
              of {activeTask.checklist.filter((item) => !item.archived).length}{" "}
              steps checked
              {activeTask.checklist.find(
                (item) => !item.archived && !item.completed,
              ) && (
                <>
                  {" "}
                  · Next step:{" "}
                  {
                    activeTask.checklist.find(
                      (item) => !item.archived && !item.completed,
                    )!.title
                  }
                </>
              )}
            </p>
          )}
          {active.activityState && (
            <section className="study-activity-panel" aria-label="Study activities">
              <div className="eyebrow">
                {active.activityState.mode === "standard"
                  ? "Adaptive study"
                  : active.activityState.mode === "quiz"
                    ? "Quiz mode"
                    : "Exam mode"}
              </div>
              <p className="muted">
                {active.activityState.mode === "exam"
                  ? "Fixed blueprint · no hints or feedback before submission."
                  : "Complete a response before asking for support; checked attempts are the learning evidence."}
              </p>
              <ol className="study-activities">
                {active.activityState.activities.map((activity) => (
                  <li key={activity.id} className={`study-activity study-activity-${activity.status}`}>
                    <div>
                      <strong>{activity.kind.replace("-", " ")}</strong>
                      <span className="muted"> · {activity.intendedDifficulty}</span>
                      <p>{activity.prompt}</p>
                      <small className="muted">{activity.rationale}</small>
                    </div>
                    <div className="actions">
                      {activity.status === "queued" && (
                        <button onClick={() => void act({ type: "session.activity", activityId: activity.id, action: "start" })}>Start</button>
                      )}
                      {activity.status === "active" && activity.hintsAllowed && (
                        <button onClick={() => void act({ type: "session.activity", activityId: activity.id, action: "hint" })}>Log hint</button>
                      )}
                      {activity.status === "active" && (
                        <>
                          <button onClick={() => void act({ type: "session.activity", activityId: activity.id, action: "skip" })}>Skip</button>
                          <button className="primary" onClick={() => void act({ type: "session.activity", activityId: activity.id, action: "complete" })}>Done</button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {kind === "main" && activeTask && (
            <SessionKit
              task={activeTask}
              data={data}
              openResource={open}
              save={(c) => act(c, true)}
            />
          )}
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
            {kind !== "main" && activeTask?.resource && (
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
  const activeHomeSummary = active && activeTask ? (
    <section className="session-home-summary" aria-label="Active study session">
      <div className="eyebrow">Study session in progress</div>
      <h2>{activeTask.title}</h2>
      <p>{Math.floor(elapsed)} min · {active.pausedAt ? "Paused" : "Working"}{active.activityState ? ` · ${active.activityState.mode === "standard" ? "Adaptive study" : active.activityState.mode === "quiz" ? "Quiz" : "Exam"}` : ""}</p>
      <p className="muted">The compact Study controller has the session controls.</p>
      <button type="button" onClick={() => void window.desk.focusController()}>Open study controller</button>
      <details className="home-work-context">
        <summary>Open work context</summary>
        <SessionKit
          task={activeTask}
          data={data}
          openResource={open}
          save={(c) => act(c, true)}
        />
      </details>
    </section>
  ) : null;
  if (!workspaceReady)
    return (
      <main className="startup-state">
        <div className="eyebrow">The Desk</div>
        <h1>{workspaceError ? "Your workspace could not open." : "Opening your workspace…"}</h1>
        {workspaceError ? (
          <>
            <p className="error" role="alert">
              {workspaceError}
            </p>
            <button
              className="primary"
              onClick={() => {
                setWorkspaceError("");
                setWorkspaceAttempt((attempt) => attempt + 1);
              }}
            >
              Try again
            </button>
          </>
        ) : (
          <p role="status">Loading your saved classes, tasks, and study history.</p>
        )}
      </main>
    );
  if (kind === "lens")
    return (
      <Lens
        title={activeTask?.title ?? "No active study context"}
        className={
          data.classes.find((c) => c.id === activeTask?.classId)?.name ?? ""
        }
        classId={activeTask?.classId}
        taskId={activeTask?.id}
        taskResource={activeTask?.resource ?? undefined}
        browserContext={browserContext}
        clearBrowserContext={async () => {
          await window.desk.clearBrowserContext();
          setBrowserContext(null);
        }}
        initialActivity={active?.activityState?.activities.find((item) => item.id === active?.activityState?.currentId)?.kind}
        sources={data.sources}
        save={(command) => act(command, true)}
      />
    );
  if (kind === "controller")
    return (
      <main className="controller">
        {(workspaceError || error) && (
          <p role="alert">{workspaceError || error}</p>
        )}
        {sessionPanel}
      </main>
    );
  return (
    <div className="shell">
      <aside>
        <div className="brand">The Desk</div>
        <Button
          variant="primary"
          size="default"
          className="new-chat-button sidebar-new-chat"
          onPress={createChatThread}
          icon={MessageChatCircle}
        >
          New chat
        </Button>
        <nav className="primary-nav" aria-label="Main">
          <Button
            variant="quiet"
            size="compact"
            icon={MessageChatCircle}
            aria-current={page === "Chat" ? "page" : undefined}
            onPress={() => setPage("Chat")}
          >
            Chat
          </Button>
        </nav>
        <section className="sidebar-group" aria-labelledby="workspace-nav-title">
          <div className="sidebar-group-title" id="workspace-nav-title">Workspace</div>
          <nav className="secondary-nav" aria-label="Workspace">
            {["Home", "Plan", "Notes", "Library"].map((p) => (
              <Button
                variant="quiet"
                size="compact"
                icon={p === "Home" ? Home01 : p === "Plan" ? Calendar : BookOpen01}
                key={p}
                aria-current={page === p ? "page" : undefined}
                onPress={() => setPage(p)}
              >
                {p === "Home" ? "Today" : p}
              </Button>
            ))}
          </nav>
        </section>
        <Button variant="quiet" size="compact" className="sidebar-capture-button" icon={FilePlus02} onPress={() => setCapture(true)}>Capture</Button>
        <Button variant="quiet" size="compact" className="sidebar-settings-button" icon={Settings01} aria-current={page === "Settings" ? "page" : undefined} onPress={() => setPage("Settings")}>Settings</Button>
        <section className="sidebar-classes" aria-labelledby="classes-nav-title">
          <div className="sidebar-group-title" id="classes-nav-title">Classes</div>
          <div className="class-list">
            {data.classes.map((c) => (
              <Button
                variant="quiet"
                size="compact"
                className="class-link"
                key={c.id}
                aria-current={page === c.id ? "page" : undefined}
                onPress={() => setPage(c.id)}
              >
                <span className="dot" />
                {c.name}
              </Button>
            ))}
          </div>
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
            <Input
              id="class"
              name="name"
              placeholder="Add a class…"
              required
              maxLength={100}
            />
            <Button size="compact" isDisabled={busy} type="submit">
              Add class
            </Button>
          </form>
        </section>
        <details className="sidebar-more">
          <summary>More tools</summary>
          <div className="sidebar-more-list">
            {["Memory", "Mistakes", "Concepts", "Attempts", "Assessments", "Evidence", "Authority", "Teachers", "Units", "Academic context", "Capture Inbox"].map((p) => (
              <Button
                variant="quiet"
                size="compact"
                key={p}
                aria-current={page === p ? "page" : undefined}
                onPress={() => setPage(p)}
              >
                {p}
              </Button>
            ))}
          </div>
        </details>
        <div className="sidebar-bottom">
          <small>Saved on this Mac</small>
        </div>
      </aside>
      <main>
        <header>
          <div className="header-context">
            <div className="eyebrow">
              {new Date(tick).toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </div>
            {page !== "Home" && (
              <span className="header-location">
                {data.classes.find((course) => course.id === page)?.name ?? page}
              </span>
            )}
          </div>
          <div className="header-actions">
            <Button
              variant="secondary"
              size="compact"
              icon={SearchMd}
              className="command-trigger"
              onPress={() => {
                setPage("Library");
                setFocusSearch(true);
              }}
            >
              <span>Search Library</span>
              <kbd>⌘K</kbd>
            </Button>
            <Button variant="secondary" size="compact" icon={FilePlus02} onPress={() => setCapture(true)}>Capture</Button>
          </div>
        </header>
        {(workspaceError || error) && (
          <p className="error" role="alert">
            {workspaceError || error}
          </p>
        )}
        {captureNotice && <p role="status">{captureNotice}</p>}
        {browserContext && (
          <section className="browser-context-notice" role="status">
            <div>
              <div className="eyebrow">Browser context ready</div>
              <strong>{browserContext.context.title || "Untitled page"}</strong>
              <p className="muted">
                {browserContext.context.browser} · {browserContext.context.url}
              </p>
            </div>
            <div className="actions">
              <button
                onClick={() => {
                  const context = browserContext.context;
                  const text = [
                    context.title,
                    context.selectionText || context.visibleText,
                    `Source: ${context.url}`,
                  ]
                    .filter((value) => Boolean(value?.trim()))
                    .join("\n\n");
                  setCaptureText(text);
                  setCapture(true);
                }}
              >
                Capture to Inbox
              </button>
              <button onClick={() => void window.desk.lens()}>Ask Lens</button>
              <button
                onClick={() =>
                  void window.desk.clearBrowserContext().then(() =>
                    setBrowserContext(null),
                  )
                }
              >
                Clear
              </button>
            </div>
          </section>
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
        {page === "Chat" ? (
          <ChatWorkspace
            data={data}
            intelligence={intelligence}
            providerConfigured={providerConfigured}
            busy={busy}
            page={page}
            threads={chatThreads}
            activeThreadId={activeChatThreadId}
            setThreads={setChatThreads}
            setActiveThreadId={setActiveChatThreadId}
            ask={(input) => window.desk.chat(input)}
            onAction={runChatAction}
            onNewChat={createChatThread}
          />
        ) : page === "Home" ? (
          <>
            <div className="home-heading">
              <div>
                <div className="eyebrow">Today</div>
                <h1>Home</h1>
                <p className="home-motto">Make room for focus.</p>
              </div>
              {active && <span className="home-live-state">Study session active</span>}
            </div>
            {testOutPlan && (
              <TestOutPanel
                plan={testOutPlan}
                classId={data.concepts.find((concept) => concept.id === testOutPlan.conceptId)?.classId ?? bestAction?.classId ?? data.classes[0]?.id ?? ""}
                save={(command) => act(command, true)}
                onDone={() => setTestOutPlan(undefined)}
              />
            )}
            {active ? activeHomeSummary : next ? (
              <section className="next">
                <div className="eyebrow">
                  Next{home.next && Date.parse(home.next.start) > tick ? ` · ${new Date(home.next.start).toLocaleDateString(undefined, { weekday: "short" })}` : ""} · {data.classes.find((c) => c.id === next.classId)?.name}
                </div>
                <h2>{next.title}</h2>
                <p>
                  {bestAction?.estimatedMinutes ?? sharedNextAction?.estimatedMinutes ?? home.next?.minutes} minutes
                  {next.resource ? " · Resource ready" : ""}
                </p>
                <details>
                  <summary>Why Desk thinks this</summary>
                  <p>{bestAction?.reason.primary ?? sharedNextAction?.reason ?? home.next?.why}</p>
                  {bestAction?.reason.factors.length ? (
                    <ul className="next-evidence">
                      {bestAction.reason.factors.slice(0, 5).map((factor) => <li key={factor.id}><strong>{factor.label}:</strong> {factor.detail}</li>)}
                    </ul>
                  ) : sharedNextAction?.evidence.length ? (
                    <ul className="next-evidence">
                      {sharedNextAction.evidence.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  ) : null}
                  {bestAction?.completionCriteria.length ? <p className="muted"><strong>Done means:</strong> {bestAction.completionCriteria.map((criterion) => criterion.label).join(" ")}</p> : null}
                </details>
                <details>
                  <summary>Preview study materials</summary>
                  <SessionKit
                    task={next}
                    data={data}
                    openResource={open}
                    save={(c) => act(c, true)}
                  />
                </details>
                <button
                  className="primary"
                  disabled={busy}
                  aria-keyshortcuts="Control+Enter Meta+Enter"
                  onClick={startNext}
                >
                  Start session → <span className="shortcut-hint" aria-hidden="true">⌘/Ctrl+Enter</span>
                </button>
                <div className="actions">
                  {bestAction?.testOut && (
                    <button type="button" disabled={busy} onClick={() => setTestOutPlan(bestAction.testOut)}>
                      Test out instead
                    </button>
                  )}
                  {bestAction?.conceptIds[0] && (
                    <button type="button" disabled={busy} onClick={() => void act({ type: "memory.create", input: { text: learningOverrideText("skip-concept", bestAction.conceptIds[0]!, "not relevant right now"), category: "planning", classId: bestAction.classId ?? null } })}>
                      Not relevant
                    </button>
                  )}
                  <button
                    disabled={busy}
                    onClick={() => void act({ type: "session.start", taskId: next.id, mode: "quiz" })}
                  >
                    Start adaptive quiz
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void act({ type: "session.start", taskId: next.id, mode: "exam" })}
                  >
                    Start fixed exam
                  </button>
                </div>
              </section>
            ) : bestAction && bestAction.kind !== "done" && bestAction.kind !== "notes" ? (
              <section className="next next-objective">
                <div className="eyebrow">Next learning move</div>
                <h2>{bestAction.title}</h2>
                <p>{bestAction.estimatedMinutes} minutes · {bestAction.reason.primary}</p>
                <details open>
                  <summary>Why Desk thinks this</summary>
                  <ul className="next-evidence">
                    {bestAction.reason.factors.map((factor) => <li key={factor.id}><strong>{factor.label}:</strong> {factor.detail}</li>)}
                  </ul>
                </details>
                <div className="actions">
                  {bestAction.testOut && <button className="primary" type="button" onClick={() => setTestOutPlan(bestAction.testOut)}>Test out</button>}
                  {learningTask && <button className="primary" type="button" disabled={busy} aria-keyshortcuts="Control+Enter Meta+Enter" onClick={startLearning}>Start study <span className="shortcut-hint" aria-hidden="true">⌘/Ctrl+Enter</span></button>}
                  {bestAction.conceptIds[0] && <button type="button" onClick={() => void act({ type: "memory.create", input: { text: learningOverrideText("skip-concept", bestAction.conceptIds[0]!, "not relevant right now"), category: "planning", classId: bestAction.classId ?? null } })}>Not relevant</button>}
                  {bestAction.classId && <button type="button" onClick={() => setPage(bestAction.classId!)}>Open class workspace</button>}
                </div>
              </section>
            ) : sharedObjective ? (
              <section className="next next-objective">
                <div className="eyebrow">Suggested review</div>
                <h2>{sharedObjective.title}</h2>
                <p>{sharedObjective.reason}</p>
                <details>
                  <summary>Why Desk thinks this</summary>
                  <ul className="next-evidence">
                    {sharedObjective.evidence.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </details>
                {sharedObjective.classId && (
                  <button className="primary" type="button" onClick={() => setPage(sharedObjective.classId!)}>
                    Open class workspace
                  </button>
                )}
                {bestAction?.testOut && <button type="button" onClick={() => setTestOutPlan(bestAction.testOut)}>Test out instead</button>}
              </section>
            ) : (
              <section className="next">
                <h2>
                  {data.classes.length
                    ? home.schedule.length ? "Nothing else needs starting today." : "Ready when you are."
                    : "Start with one class."}
                </h2>
                <p>
                  {data.classes.length
                    ? home.schedule.length ? "Your next planned block is shown in Upcoming." : "Capture an assignment to plan your next session."
                    : "Add a class, then capture your first assignment."}
                </p>
                <button onClick={() => setCapture(true)}>
                  Capture assignment
                </button>
              </section>
            )}
            {home.planChange && (
              <p className="plan-change-note" role="status">
                <strong>Plan updated.</strong> {home.planChange.text}
              </p>
            )}
            {intelligence?.learningLoop && (intelligence.learningLoop.effectiveLearning.trackedMinutes > 0 || intelligence.learningLoop.incompleteLoops.length > 0) && (
              <details className="learning-signal">
                <summary>What the last study work established</summary>
                <p>{intelligence.learningLoop.effectiveLearning.trackedMinutes} tracked min · {intelligence.learningLoop.effectiveLearning.evidenceMinutes} min with checked evidence</p>
                <p className="muted">{intelligence.learningLoop.effectiveLearning.explanation}</p>
                {intelligence.learningLoop.incompleteLoops.slice(0, 3).map((loop) => <p key={loop.id}><strong>{loop.title}:</strong> {loop.detail}</p>)}
              </details>
            )}
            <h2 className="section-title">Today</h2>
            {home.today.map((b) => (
              <div className="row" key={b.taskId}>
                <span>{data.tasks.find((t) => t.id === b.taskId)?.title}<small>{new Date(b.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</small></span>
                <span>{b.minutes} min</span>
              </div>
            ))}
            {!home.today.length && (
              <p className="muted">No remaining study blocks planned today.</p>
            )}
            {!!homeClassRows.length && (
              <section aria-labelledby="home-classes-title" className="home-class-status">
                <h2 className="section-title" id="home-classes-title">Classes</h2>
                {homeClassRows.map(({ course, first, count }) => (
                  <button className="home-class-row" type="button" key={course.id} onClick={() => setPage(course.id)}>
                    <span className="home-class-name"><span className="dot" />{course.name}</span>
                    <span className="home-class-detail">
                      {first ? <><strong>{first.title}</strong><small>{first.dueAt ? `Due ${new Date(first.dueAt).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}` : "No due date"}{count > 1 ? ` · ${count} open` : ""}</small></> : <><strong>All clear</strong><small>No unfinished work</small></>}
                    </span>
                    <span className="home-class-arrow" aria-hidden="true">›</span>
                  </button>
                ))}
              </section>
            )}
            {!active && (home.attention.length > 0 || (unreviewed && reviewTask)) && (
              <section aria-labelledby="home-attention-title">
                <h2 className="section-title" id="home-attention-title">Needs attention</h2>
                {unreviewed && reviewTask && (
                  <SessionReview
                    key={unreviewed.id}
                    session={unreviewed}
                    canCorrect={
                      data.sessions.filter((s) => s.taskId === reviewTask.id).at(-1)
                        ?.id === unreviewed.id
                    }
                    task={reviewTask}
                    concepts={data.concepts.filter(
                      (concept) => concept.classId === reviewTask.classId,
                    )}
                    save={act}
                    busy={busy}
                  />
                )}
                {home.attention.filter((item) => item.kind !== "session-review").map((item) => (
                  <div className="attention" key={item.id}>
                    <strong>{item.title}</strong>
                    <p>{item.detail}</p>
                    {item.kind === "overload" ? (
                      <button type="button" onClick={() => { setPlanRepairRequested(true); setPage("Plan"); }}>Repair plan</button>
                    ) : item.kind === "integration" ? (
                      <button type="button" onClick={() => setPage("Settings")}>Review sync</button>
                    ) : item.taskId ? (
                      <button type="button" onClick={() => setEditing(data.tasks.find((task) => task.id === item.taskId))}>Review assignment</button>
                    ) : null}
                  </div>
                ))}
              </section>
            )}
            {!!home.upcoming.length && (
              <section aria-labelledby="home-upcoming-title">
                <h2 className="section-title" id="home-upcoming-title">Upcoming</h2>
                {home.upcoming.map((item) => (
                  <div className="row" key={item.id}>
                    <span>{item.title}<small>{item.kind === "assessment" ? "Assessment" : "Deadline"} · {data.classes.find((c) => c.id === item.classId)?.name}</small></span>
                    <span>{new Date(item.dueAt).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>
                  </div>
                ))}
              </section>
            )}
            {!!home.continue.length && (
              <section aria-labelledby="home-continue-title">
                <h2 className="section-title" id="home-continue-title">Continue</h2>
                {home.continue.map((item) => (
                  <div className="row home-continue-row" key={item.id}>
                    <span>{item.title}<small>{item.detail}</small></span>
                    {item.kind === "note" && item.canvasId ? (
                      <button type="button" onClick={() => void openCanvas(item.taskId, item.canvasId, item.blockId)}>Open Note</button>
                    ) : item.kind === "session" ? (
                      <button type="button" onClick={() => void act({ type: "session.start", taskId: item.taskId })}>Resume</button>
                    ) : (
                      <button type="button" onClick={() => setEditing(data.tasks.find((task) => task.id === item.taskId))}>Open</button>
                    )}
                  </div>
                ))}
              </section>
            )}
          </>
        ) : page === "Notes" ? (
          <NotesHub data={data} openCanvas={openCanvas} newNotebook={newNotebook} save={(c) => act(c, true)} />
        ) : page === "Memory" ? (
          <Memory data={data} save={(c) => act(c, true)} />
        ) : page === "Mistakes" ? (
          <Mistakes data={data} save={(c) => act(c, true)} />
        ) : page === "Concepts" ? (
          <Concepts data={data} save={(c) => act(c, true)} />
        ) : page === "Attempts" ? (
          <Attempts data={data} save={(c) => act(c, true)} />
        ) : page === "Assessments" ? (
          <Assessments data={data} save={(c) => act(c, true)} />
        ) : page === "Evidence" ? (
          <Evidence data={data} save={(c) => act(c, true)} />
        ) : page === "Authority" ? (
          <Authority data={data} save={(c) => act(c, true)} />
        ) : page === "Teachers" ? (
          <Teachers data={data} save={(c) => act(c, true)} />
        ) : page === "Units" ? (
          <Units data={data} save={(c) => act(c, true)} />
        ) : page === "Academic context" ? (
          <AcademicContext data={data} save={(c) => act(c, true)} />
        ) : page === "Plan" ? (
          <StudyPlan data={data} week={week} save={(c) => act(c, true)} autoPreview={planRepairRequested} onAutoPreview={() => setPlanRepairRequested(false)} />
        ) : page === "Settings" ? (
          <>
            <h1>Settings</h1>
            <UserSettings
              user={data.user}
              save={(c) => act(c, true)}
              exportData={() => window.desk.exportData()}
              exportRecordings={() => window.desk.exportRecordings()}
              deleteData={async () => {
                const next = await window.desk.deleteLocalData();
                setData(next);
                return next;
              }}
            />
            <PlanningSettings
              preferences={data.planning}
              mode={data.planningMode}
              saveMode={(mode) => act({ type: "planning.mode", mode }, true)}
              save={(input) =>
                act({ type: "planning.preferences", input }, true)
              }
            />
            <CapturePolicySettings
              mode={data.capturePolicy}
              save={(mode) => act({ type: "capture.policy", mode }, true)}
            />
            <ProviderSettings />
            <AccountSettings />
            <ConnectionsSettings />
            <BrowserBridgeSettings />
            <SyncSettings
              outbox={data.outbox}
              conflicts={data.syncConflicts}
              status={syncStatus}
              syncNow={async () => {
                const next = await window.desk.syncNow();
                setSyncStatus(next);
                setData(await window.desk.snapshot());
                return next;
              }}
              save={(c) => act(c, true)}
            />
            <h2>Lens</h2>
            <p>
              Hold Option/Alt + Space, circle something while you talk, and
              release to ask Lens. Double-tap the same shortcut for a typed
              question. Lens needs Screen Recording, Microphone, and Input
              Monitoring permission to work from any app.
            </p>
            <p className={lensHotkeyStatus.available ? "muted" : "error"} role="status">
              {lensHotkeyStatus.message}
            </p>
          </>
        ) : page === "Capture Inbox" ? (
          <CaptureInbox
            items={data.captureInbox}
            busy={busy}
            review={setReviewingCapture}
            change={(c) => act(c, true)}
          />
        ) : (
          <Library
            data={data}
            nextAction={intelligence?.nextAction}
            classId={data.classes.some((c) => c.id === page) ? page : undefined}
            open={open}
            edit={setEditing}
            saveGrade={(c) => act(c, true)}
            saveProgress={(c) => act(c, true)}
            saveSource={(input) => act({ type: "source.create", input }, true)}
            saveCommand={(c) => act(c, true)}
            openCanvas={openCanvas}
            newNotebook={newNotebook}
            navigate={setPage}
            startTask={(taskId) => {
              void act({ type: "session.start", taskId });
            }}
          />
        )}
      </main>
      {canvas && (
        <React.Suspense fallback={<p>Opening notes…</p>}>
          <Canvas
            record={canvas}
            sources={data.sources}
            initialBlockId={canvas.initialBlockId}
            close={() => setCanvas(undefined)}
          />
        </React.Suspense>
      )}
      {editing && (
        <Capture
          policy={data.capturePolicy}
          timeZone={data.user?.timeZone}
          classes={data.classes}
          gradeCategories={data.gradeCategories}
          tasks={data.tasks}
          sessions={learningSessions(data)}
          busy={busy}
          onInfer={(input) => window.desk.infer(input)}
          existing={editing}
          onClose={() => setEditing(undefined)}
          onSave={async (input, deadlineChangeApproved) =>
            Boolean(
              await act(
                {
                  type: "task.update",
                  id: editing.id,
                  input,
                  deadlineChangeApproved,
                },
                true,
              ),
            )
          }
        />
      )}
      {reviewingCapture && (
        <Capture
          key={reviewingCapture.id}
          policy={data.capturePolicy}
          timeZone={data.user?.timeZone}
          classes={data.classes}
          gradeCategories={data.gradeCategories}
          tasks={data.tasks}
          sessions={learningSessions(data)}
          busy={busy}
          onInfer={(input) => window.desk.infer(input)}
          initialDraft={reviewingCapture.draft}
          onClose={() => setReviewingCapture(undefined)}
          onSave={async (input) => {
            const next = await act(
              {
                type: "inbox.accept",
                id: reviewingCapture.id,
                revision: reviewingCapture.revision,
                input,
              },
              true,
            );
            if (!next) return false;
            setLastId(next.tasks.at(-1)!.id);
            return true;
          }}
        />
      )}
      {capture && (
        <Capture
          initialText={captureText}
          contextClassId={captureContextClassId}
          timeZone={data.user?.timeZone}
          policy={data.capturePolicy}
          classes={data.classes}
          gradeCategories={data.gradeCategories}
          tasks={data.tasks}
          sessions={learningSessions(data)}
          busy={busy}
          onInfer={(input) => window.desk.infer(input)}
          onImport={async () => {
            setBusy(true);
            try {
              const next = await window.desk.importCaptureFiles();
              if (!next) return;
              setData(next);
              const items = next.captureInbox.slice(data.captureInbox.length);
              setCaptureNotice(
                `Import saved: ${items.filter((i) => i.status === "accepted").length} filed, ${items.filter((i) => i.status === "pending").length} waiting for review.`,
              );
              setCapture(false);
              setCaptureText("");
              setPage("Capture Inbox");
            } finally {
              setBusy(false);
            }
          }}
          onQueue={async (text, contextClassId) => {
            const next = await act(
              {
                type: "inbox.capture",
                text,
                timeZone: resolveTimeZone(data.user?.timeZone),
                ...(contextClassId ? { contextClassId } : {}),
              },
              true,
            );
            const items = next!.captureInbox.slice(data.captureInbox.length);
            setCaptureNotice(
              `Capture saved: ${items.filter((i) => i.status === "accepted").length} filed, ${items.filter((i) => i.status === "pending").length} waiting for review.`,
            );
            setCapture(false);
            setCaptureText("");
            setPage("Capture Inbox");
          }}
          onClose={() => {
            setCapture(false);
            setCaptureText("");
          }}
          onSave={async (input) => {
            const next = await act({ type: "task.create", input }, true);
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

function NotesHub({
  data,
  openCanvas,
  newNotebook,
  save,
}: {
  data: Snapshot;
  openCanvas: (taskId: string | null, canvasId?: string, blockId?: string) => Promise<void>;
  newNotebook: (taskId: string | null, classId?: string | null) => Promise<void>;
  save: (command: Command) => Promise<Snapshot | undefined>;
}) {
  const [contextError, setContextError] = useState("");
  const notes = data.canvases
    .map((note) => ({
      note,
      task: data.tasks.find((task) => task.id === note.taskId),
    }))
    .sort((a, b) => Date.parse(b.note.updatedAt) - Date.parse(a.note.updatedAt));
  return (
    <section className="notes-hub" aria-labelledby="notes-title">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Workspace</div>
          <h1 id="notes-title">Notes</h1>
          <p className="page-lede">Your typed notes and freeform thinking, together.</p>
        </div>
        <div className="actions">
          <button type="button" className="primary" onClick={() => void newNotebook(null)}>New note</button>
          <span className="muted">{notes.length} {notes.length === 1 ? "note" : "notes"}</span>
        </div>
      </div>
      {notes.length ? (
        <div className="notes-list">
          {contextError && <p className="error" role="alert">{contextError}</p>}
          {notes.map(({ note, task }) => (
            <article className="notes-list-row" key={note.id}>
              <div>
                <div className="eyebrow">{task ? data.classes.find((item) => item.id === task.classId)?.name ?? "Class note" : note.classId ? data.classes.find((item) => item.id === note.classId)?.name ?? "Class note" : "No class yet"}</div>
                <h2>{note.title || task?.title || "Untitled note"}</h2>
                <p className="muted">Updated {new Date(note.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</p>
                {!task && (
                  <label className="note-context-picker">
                    <span className="sr-only">Class for {note.title || "this note"}</span>
                    <select
                      aria-label={`Class for ${note.title || "this note"}`}
                      value={note.classId ?? ""}
                      onChange={(event) => {
                        setContextError("");
                        void save({
                          type: "canvas.context",
                          id: note.id,
                          revision: note.revision,
                          input: { classId: event.target.value || null },
                        }).catch((value) => setContextError(userError(value)));
                      }}
                    >
                      <option value="">No class</option>
                      {data.classes.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
                    </select>
                  </label>
                )}
              </div>
              <button type="button" className="primary" onClick={() => void openCanvas(note.taskId, note.id)}>Open note</button>
            </article>
          ))}
        </div>
      ) : (
        <section className="empty-state">
          <div className="empty-state-mark">N</div>
          <h2>Start with a note</h2>
          <p>Start writing now. Add a class or connect a source whenever it becomes useful.</p>
          <div className="empty-state-actions">
            <button type="button" className="primary" onClick={() => void newNotebook(null)}>New note</button>
            {data.tasks.length > 0 && (
              <details>
                <summary>Start from an assignment</summary>
                <div className="empty-state-actions">
                  {data.tasks.slice(0, 3).map((task) => (
                    <button key={task.id} type="button" onClick={() => void newNotebook(task.id)}>
                      New note · {task.title}
                    </button>
                  ))}
                </div>
              </details>
            )}
          </div>
        </section>
      )}
    </section>
  );
}

function Library({
  data,
  nextAction,
  classId,
  open,
  edit,
  saveSource,
  saveCommand,
  saveGrade,
  saveProgress,
  openCanvas,
  newNotebook,
  navigate,
  startTask,
}: {
  data: Snapshot;
  nextAction?: DeskIntelligence["nextAction"];
  classId?: string;
  open: (id: string) => Promise<void>;
  edit: (task: Task) => void;
  saveGrade: (c: Command) => Promise<unknown>;
  saveProgress: (c: Command) => Promise<unknown>;
  saveSource: (
    input: import("../../../packages/domain/contracts").SourceInput,
  ) => Promise<unknown>;
  saveCommand: (command: Command) => Promise<Snapshot | undefined>;
  openCanvas: (taskId: string | null, canvasId?: string, blockId?: string) => Promise<void>;
  newNotebook: (taskId: string | null, classId?: string | null) => Promise<void>;
  navigate: (page: string) => void;
  startTask: (taskId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [indexed, setIndexed] = useState<SearchResult[]>([]);
  const [readerTarget, setReaderTarget] = useState<{ sourceId: string; location?: SearchResult["location"] }>();
  const readerSource = readerTarget
    ? data.sources.find((source) => source.id === readerTarget.sourceId)
    : undefined;
  useEffect(() => {
    const query = search.trim();
    if (!query) {
      setIndexed([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void window.desk.search(query).then((results) => {
        if (active) setIndexed(results);
      }).catch(() => {
        if (active) setIndexed([]);
      });
    }, 120);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [search]);
  return (
    <>
      {classId ? (
        <ClassOverview
          data={data}
          nextAction={nextAction}
          classId={classId}
          openCanvas={openCanvas}
          openSource={(sourceId) => setReaderTarget({ sourceId })}
          editTask={edit}
          startTask={startTask}
          navigate={navigate}
          saveGrade={saveGrade}
        />
      ) : <h1>Library</h1>}
      {!classId && <>
      <label htmlFor="search">Search tasks, Notes, sources and math</label>
      <input
        id="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {!!search.trim() && (
        <section className="search-results" aria-label="Unified search results">
          <div className="eyebrow">Everywhere in your Desk</div>
          {indexed.length ? indexed.map((result) => (
            <button key={`${result.kind}-${result.id}-${result.blockId ?? ""}`} className="search-result" type="button" onClick={() => {
              if (result.kind === "note") void openCanvas(result.taskId ?? null, result.id, result.blockId);
              else if (result.kind === "source") setReaderTarget({ sourceId: result.id, location: result.location });
              else if (result.kind === "annotation" && result.sourceId) setReaderTarget({ sourceId: result.sourceId, location: result.location });
            }}>
              <span className="search-result-kind">{result.kind === "note" ? "NOTE" : result.kind.toUpperCase()}</span>
              <span><strong>{result.title}</strong><small>{result.snippet}</small></span>
            </button>
          )) : <p className="muted">No indexed matches yet.</p>}
        </section>
      )}
      <Sources
        data={data}
        classId={classId}
        search={search}
        save={saveSource}
        openReader={(source) => setReaderTarget({ sourceId: source.id })}
        classify={(source, kind) =>
          saveProgress({
            type: "source.classify",
            id: source.id,
            revision: source.revision ?? 0,
            kind,
          })
        }
      />
      </>}
      {readerSource && (
        <SourceReader
          source={readerSource}
          data={data}
          initialLocation={readerTarget?.location}
          close={() => setReaderTarget(undefined)}
          saveCommand={saveCommand}
          openCanvas={openCanvas}
        />
      )}
      {!classId && <>
      {data.tasks
        .filter(
          (t) =>
            (!classId || t.classId === classId) &&
            `${t.title} ${t.notes}`
              .toLowerCase()
              .includes(search.toLowerCase()),
        )
        .length > 0 && classId && <h2 className="class-library-heading">Assignments &amp; study</h2>}
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
              {t.autoPlanPending && (
                <p>
                  Auto-plan will reserve time after the active study session
                  ends.
                </p>
              )}
              {t.notes && <p>{t.notes}</p>}
              <details>
                <summary>Assignment checklist</summary>
                <TaskChecklist task={t} save={saveProgress} />
              </details>
              <button onClick={() => edit(t)}>Edit assignment</button>
              <button onClick={() => void openCanvas(t.id)}>Open Notes</button>
              <button onClick={() => void newNotebook(t.id)}>
                New notebook
              </button>
              {data.canvases
                .filter((c) => c.taskId === t.id)
                .slice(1)
                .map((c) => (
                  <button
                    key={c.id}
                    onClick={() => void openCanvas(t.id, c.id)}
                  >
                    Open {c.title}
                  </button>
                ))}
              {data.sessions.some((s) => s.taskId === t.id && s.endedAt) && (
                <details>
                  <summary>Study history</summary>
                  {data.sessions
                    .filter((s) => s.taskId === t.id && s.endedAt)
                    .map((s) => (
                      <div key={s.id}>
                        <p>
                          {new Date(s.endedAt!).toLocaleString()} ·{" "}
                          {Math.round(s.actualMinutes ?? 0)} min tracked
                        </p>
                        <p>
                          {s.completionReported === undefined
                            ? "Completion not reported"
                            : s.completionReported
                              ? "Reported finished"
                              : "Reported unfinished"}
                        </p>
                        {!!s.checklistAtEnd?.length && (
                          <details>
                            <summary>Checklist at session end</summary>
                            <ul>
                              {s.checklistAtEnd.map((item) => (
                                <li key={item.id}>
                                  {item.completed ? "Checked" : "Unchecked"} ·{" "}
                                  {item.title}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                        {s.estimateAtStart && (
                          <p>
                            {s.estimateAtStart.minutes} min estimated remaining
                            at start
                          </p>
                        )}
                        {s.review?.notes && <p>{s.review.notes}</p>}
                        {!!s.corrections?.length && (
                          <details>
                            <summary>Correction history</summary>
                            {s.corrections.map((correction, index) => (
                              <div key={index}>
                                <p>
                                  {new Date(
                                    correction.correctedAt,
                                  ).toLocaleString()}{" "}
                                  ·{" "}
                                  {correction.fromCompleted === null
                                    ? "Unreported"
                                    : correction.fromCompleted
                                      ? "Finished"
                                      : "Unfinished"}{" "}
                                  →{" "}
                                  {correction.toCompleted
                                    ? "Finished"
                                    : "Unfinished"}
                                </p>
                                {correction.previousReview?.notes && (
                                  <p>
                                    Previous notes:{" "}
                                    {correction.previousReview.notes}
                                  </p>
                                )}
                                {correction.remainingMinutes !== null && (
                                  <p>
                                    {correction.remainingMinutes} minutes
                                    remaining after correction
                                  </p>
                                )}
                              </div>
                            ))}
                          </details>
                        )}
                        {data.sessions
                          .filter((session) => session.taskId === t.id)
                          .at(-1)?.id === s.id && (
                          <SessionCorrection
                            session={s}
                            task={t}
                            save={saveProgress}
                          />
                        )}
                        {s.review?.remainingMinutes != null && (
                          <p>
                            {s.review.remainingMinutes} minutes remaining,
                            reported at review
                          </p>
                        )}
                      </div>
                    ))}
                </details>
              )}
              {t.resource && (
                <button onClick={() => void open(t.id)}>Open resource</button>
              )}
            </div>
            <span>{t.minutes} min</span>
          </article>
        ))}
      </>}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
