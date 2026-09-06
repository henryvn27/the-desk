import { planWeek } from "../planner";
import { startNotebook } from "../canvas/notebook";
import type { LensTelemetryEvent } from "../intelligence/lens-provider";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  command,
  defaultPlanningPreferences,
  planningPreferences,
  type Command,
  type GradeCategory,
  type GradeEntry,
  type RebalancePreview,
  type PlanChange,
  type StudyBlock,
  type Snapshot,
  type Task,
  type Class,
  type StudySession,
  type Source,
  type CanvasRecord,
} from "./contracts";
export class DeskStore {
  private db: DatabaseSync;
  private rebalance?: { preview: RebalancePreview; basis: string };
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;");
    const version = (
      this.db.prepare("PRAGMA user_version").get() as { user_version: number }
    ).user_version;
    if (version > 17) {
      this.db.close();
      throw Error("This data requires a newer Desk version.");
    }
    if (version === 0)
      this.db
        .exec(`BEGIN; CREATE TABLE classes(id TEXT PRIMARY KEY,name TEXT NOT NULL,color TEXT NOT NULL);
  CREATE TABLE tasks(id TEXT PRIMARY KEY,class_id TEXT NOT NULL REFERENCES classes(id),data TEXT NOT NULL);
  CREATE TABLE sessions(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),data TEXT NOT NULL,active INTEGER NOT NULL);
  CREATE UNIQUE INDEX one_active_session ON sessions(active) WHERE active=1;
  CREATE TABLE outbox(id TEXT PRIMARY KEY,entity_id TEXT NOT NULL,operation TEXT NOT NULL,created_at TEXT NOT NULL);
  PRAGMA user_version=1; COMMIT;`);
    if (version <= 1)
      this.db.exec(
        "BEGIN; CREATE TABLE ai_runs(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,session_id TEXT,feature TEXT NOT NULL,data TEXT NOT NULL); PRAGMA user_version=2; COMMIT;",
      );
    if (version <= 2)
      this.db.exec(
        "BEGIN; CREATE TABLE settings(id TEXT PRIMARY KEY,data TEXT NOT NULL); PRAGMA user_version=3; COMMIT;",
      );
    if (version <= 3)
      this.db.exec(`BEGIN;
      CREATE TABLE sources(id TEXT PRIMARY KEY,title TEXT NOT NULL,text TEXT NOT NULL,createdAt TEXT NOT NULL,authority TEXT NOT NULL);
      CREATE TABLE source_classes(source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,class_id TEXT NOT NULL REFERENCES classes(id),PRIMARY KEY(source_id,class_id));
      CREATE TABLE source_tasks(source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,PRIMARY KEY(source_id,task_id));
      PRAGMA user_version=4; COMMIT;`);
    if (version <= 4)
      this.db.exec(
        "BEGIN; CREATE TABLE canvases(id TEXT PRIMARY KEY,taskId TEXT NOT NULL REFERENCES tasks(id),title TEXT NOT NULL,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,revision INTEGER NOT NULL,scene TEXT NOT NULL); PRAGMA user_version=5; COMMIT;",
      );
    // Notebook content lives inside page envelopes. Older renderers would save
    // only root elements, so prevent them from opening this document format.
    if (version <= 5) this.db.exec("BEGIN; PRAGMA user_version=6; COMMIT;");
    if (version <= 6)
      this.db.exec(`BEGIN;
      CREATE TABLE study_blocks(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),data TEXT NOT NULL);
      PRAGMA user_version=7; COMMIT;`);
    if (version <= 7) this.db.exec("BEGIN; PRAGMA user_version=8; COMMIT;");
    if (version <= 8)
      this.db.exec(
        "BEGIN; CREATE TABLE plan_changes(id TEXT PRIMARY KEY,appliedAt TEXT NOT NULL,data TEXT NOT NULL); PRAGMA user_version=9; COMMIT;",
      );
    if (version <= 9) this.db.exec("BEGIN; PRAGMA user_version=10; COMMIT;");
    if (version <= 10)
      this.db.exec(`BEGIN;
      CREATE TABLE grade_categories(id TEXT PRIMARY KEY,class_id TEXT NOT NULL REFERENCES classes(id),data TEXT NOT NULL);
      CREATE TABLE grade_entries(id TEXT PRIMARY KEY,category_id TEXT NOT NULL REFERENCES grade_categories(id),data TEXT NOT NULL);
      PRAGMA user_version=11; COMMIT;`);
    if (version <= 11) this.db.exec("BEGIN; PRAGMA user_version=12; COMMIT;");
    if (version <= 12) this.db.exec("BEGIN; PRAGMA user_version=13; COMMIT;");
    if (version <= 13) this.db.exec("BEGIN; PRAGMA user_version=14; COMMIT;");
    if (version <= 14) this.db.exec("BEGIN; PRAGMA user_version=15; COMMIT;");
    if (version <= 15) this.db.exec("BEGIN; PRAGMA user_version=16; COMMIT;");
    if (version <= 16) this.db.exec("BEGIN; PRAGMA user_version=17; COMMIT;");
  }
  previewRebalance(now = new Date()): RebalancePreview {
    const state = this.snapshot();
    if (state.sessions.some((s) => !s.endedAt))
      throw Error("Finish the active study session before rebalancing.");
    const planningStart = new Date(+now + 180000);
    const live = state.studyBlocks.filter((b) => !b.cancelledAt);
    const replaced = live.filter(
      (b) => !b.locked && Date.parse(b.start) > +planningStart,
    );
    const kept = live.filter((b) => !replaced.some((r) => r.id === b.id));
    const result = planWeek(
      state.tasks,
      planningStart,
      state.planning,
      kept,
      state,
    );
    const preview: RebalancePreview = {
      id: randomUUID(),
      createdAt: now.toISOString(),
      expiresAt: new Date(+now + 120000).toISOString(),
      replaced,
      kept,
      unscheduled: result.unscheduled,
      added: result.blocks.map((b) => ({
        ...b,
        id: randomUUID(),
        locked: false,
        revision: 0,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      })),
    };
    this.rebalance = { preview, basis: this.planningBasis(state) };
    return structuredClone(preview);
  }
  private planningBasis(state: Snapshot) {
    return JSON.stringify([
      state.tasks,
      state.studyBlocks,
      state.planning,
      state.planningMode,
      state.sessions,
      state.gradeCategories,
      state.gradeEntries,
    ]);
  }
  recordAI(event: LensTelemetryEvent, sessionId: string | null) {
    this.db
      .prepare("INSERT INTO ai_runs VALUES(?,?,?,?,?)")
      .run(randomUUID(), "local", sessionId, "lens", JSON.stringify(event));
  }
  snapshot(): Snapshot {
    const mode = this.db
      .prepare("SELECT data FROM settings WHERE id='planning-mode'")
      .get()?.data;
    if (mode !== undefined && mode !== '"suggest"' && mode !== '"auto-plan"')
      throw Error("Stored planning mode is invalid.");
    const classLinks = this.db.prepare("SELECT * FROM source_classes").all();
    const taskLinks = this.db.prepare("SELECT * FROM source_tasks").all();
    const settings = this.db
      .prepare("SELECT data FROM settings WHERE id='planning'")
      .get();
    return {
      planningMode: mode === '"suggest"' ? "suggest" : "auto-plan",
      gradeCategories: this.db
        .prepare("SELECT data FROM grade_categories")
        .all()
        .map((r) => JSON.parse(r.data as string) as GradeCategory),
      gradeEntries: this.db
        .prepare("SELECT data FROM grade_entries")
        .all()
        .map((r) => JSON.parse(r.data as string) as GradeEntry),
      planChanges: this.db
        .prepare(
          "SELECT data FROM plan_changes ORDER BY appliedAt DESC,rowid DESC LIMIT 50",
        )
        .all()
        .map((r) => JSON.parse(r.data as string) as PlanChange),
      studyBlocks: this.db
        .prepare("SELECT data FROM study_blocks")
        .all()
        .map((r) => JSON.parse(r.data as string) as StudyBlock)
        .sort(
          (a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id),
        ),
      canvases: this.db
        .prepare(
          "SELECT id,taskId,title,createdAt,updatedAt,revision FROM canvases",
        )
        .all() as Omit<CanvasRecord, "scene">[],
      sources: this.db
        .prepare("SELECT * FROM sources")
        .all()
        .map((r) => ({
          ...r,
          classIds: classLinks
            .filter((l) => l.source_id === r.id)
            .map((l) => l.class_id),
          taskIds: taskLinks
            .filter((l) => l.source_id === r.id)
            .map((l) => l.task_id),
        })) as Source[],
      planning: settings
        ? planningPreferences.parse(JSON.parse(settings.data as string))
        : { ...defaultPlanningPreferences },
      classes: this.db.prepare("SELECT * FROM classes").all() as Class[],
      tasks: this.db
        .prepare("SELECT data FROM tasks")
        .all()
        .map((r) => JSON.parse(r.data as string) as Task),
      sessions: this.db
        .prepare("SELECT data FROM sessions ORDER BY rowid")
        .all()
        .map((r) => JSON.parse(r.data as string) as StudySession),
    };
  }
  execute(raw: Command, now = new Date()): Snapshot {
    const c = command.parse(raw);
    const timestamp = now.toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const state = this.snapshot();
      const active = state.sessions.find((s) => !s.endedAt);
      let entityId = "";
      if (c.type === "planning.mode") {
        entityId = "planning-mode";
        this.db
          .prepare(
            "INSERT INTO settings VALUES('planning-mode',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
          )
          .run(JSON.stringify(c.mode));
        if (c.mode === "suggest")
          for (const task of state.tasks.filter((t) => t.autoPlanPending)) {
            const updated = { ...task };
            delete updated.autoPlanPending;
            this.db
              .prepare("UPDATE tasks SET data=? WHERE id=?")
              .run(JSON.stringify(updated), task.id);
            this.queue(task.id, "task.auto-plan-cancelled", timestamp);
          }
      }
      if (c.type === "grade.category") {
        if (!state.classes.some((course) => course.id === c.input.classId))
          throw Error("Class no longer exists.");
        const existing = state.gradeCategories.find(
          (category) => category.id === c.id,
        );
        if (c.id && (!existing || existing.revision !== c.revision))
          throw Error("This category changed. Refresh before editing.");
        if (existing && existing.classId !== c.input.classId)
          throw Error("A category cannot move between classes.");
        const total =
          state.gradeCategories
            .filter(
              (category) =>
                category.classId === c.input.classId && category.id !== c.id,
            )
            .reduce((sum, category) => sum + category.weight, 0) +
          c.input.weight;
        if (total > 100.0000001)
          throw Error("Category weights cannot exceed 100%.");
        entityId = existing?.id ?? randomUUID();
        const category: GradeCategory = {
          ...c.input,
          id: entityId,
          revision: (existing?.revision ?? -1) + 1,
        };
        this.db
          .prepare(
            "INSERT INTO grade_categories VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
          )
          .run(entityId, c.input.classId, JSON.stringify(category));
      }
      if (c.type === "grade.entry") {
        const category = state.gradeCategories.find(
          (category) => category.id === c.input.categoryId,
        );
        if (!category) throw Error("Grade category no longer exists.");
        const existing = state.gradeEntries.find((entry) => entry.id === c.id);
        if (c.id && (!existing || existing.revision !== c.revision))
          throw Error("This score changed. Refresh before editing.");
        if (
          existing &&
          state.gradeCategories.find((cat) => cat.id === existing.categoryId)
            ?.classId !== category.classId
        )
          throw Error("A score cannot move between classes.");
        entityId = existing?.id ?? randomUUID();
        const entry: GradeEntry = {
          ...c.input,
          id: entityId,
          revision: (existing?.revision ?? -1) + 1,
          recordedAt: existing?.recordedAt ?? timestamp,
          updatedAt: timestamp,
          authority: "user-entered",
        };
        this.db
          .prepare(
            "INSERT INTO grade_entries VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET category_id=excluded.category_id,data=excluded.data",
          )
          .run(entityId, c.input.categoryId, JSON.stringify(entry));
      }
      if (c.type === "planning.rebalance") {
        const pending = this.rebalance;
        if (
          !pending ||
          pending.preview.id !== c.previewId ||
          Date.parse(pending.preview.createdAt) > +now ||
          Date.parse(pending.preview.expiresAt) <= +now ||
          pending.basis !== this.planningBasis(state)
        )
          throw Error(
            "The plan changed or this preview expired. Preview the rebalance again.",
          );
        if (!c.approved)
          throw Error(
            "Approve the proposed commitment changes before applying them.",
          );
        const preview = pending.preview;
        for (const block of preview.replaced) {
          this.db.prepare("UPDATE study_blocks SET data=? WHERE id=?").run(
            JSON.stringify({
              ...block,
              cancelledAt: timestamp,
              updatedAt: timestamp,
              revision: block.revision + 1,
            }),
            block.id,
          );
          this.queue(block.id, "block.rebalanced", timestamp);
        }
        for (const block of preview.added) {
          this.db
            .prepare("INSERT INTO study_blocks VALUES(?,?,?)")
            .run(block.id, block.taskId, JSON.stringify(block));
          this.queue(block.id, "block.create", timestamp);
        }
        entityId = preview.id;
        this.db
          .prepare("INSERT INTO plan_changes VALUES(?,?,?)")
          .run(
            entityId,
            timestamp,
            JSON.stringify({ ...preview, appliedAt: timestamp }),
          );
      }
      if (c.type === "block.cancel") {
        const existing = state.studyBlocks.find((b) => b.id === c.id);
        if (
          !existing ||
          existing.cancelledAt ||
          existing.revision !== c.revision
        )
          throw Error(
            "This block changed. Refresh your plan before cancelling it.",
          );
        if (!c.cancellationApproved)
          throw Error(
            existing.locked
              ? "Confirm cancelling this locked block."
              : "Confirm releasing this reserved time.",
          );
        entityId = existing.id;
        this.db.prepare("UPDATE study_blocks SET data=? WHERE id=?").run(
          JSON.stringify({
            ...existing,
            cancelledAt: timestamp,
            updatedAt: timestamp,
            revision: existing.revision + 1,
          }),
          existing.id,
        );
      }
      if (c.type === "block.create" || c.type === "block.update") {
        const existing =
          c.type === "block.update"
            ? state.studyBlocks.find((b) => b.id === c.id)
            : undefined;
        if (
          c.type === "block.update" &&
          (!existing ||
            existing.cancelledAt ||
            existing.revision !== c.revision)
        )
          throw Error(
            "This block changed. Refresh your plan before editing it.",
          );
        const taskId = c.type === "block.create" ? c.taskId : existing!.taskId;
        const task = state.tasks.find((t) => t.id === taskId);
        if (!task || task.completed)
          throw Error("Choose an unfinished assignment.");
        const start = Date.parse(c.input.start);
        const end = start + c.input.minutes * 60000;
        const changesTime =
          !existing ||
          existing.start !== c.input.start ||
          existing.minutes !== c.input.minutes;
        if (changesTime && start < +now)
          throw Error("Choose a future start time.");
        if (
          c.type === "block.update" &&
          existing!.locked &&
          (changesTime || !c.locked) &&
          !c.lockedChangeApproved
        )
          throw Error("Confirm changing this locked block.");
        if (
          changesTime &&
          task.dueAt &&
          end > Date.parse(task.dueAt) &&
          !c.beyondDeadlineApproved
        )
          throw Error("Confirm scheduling work beyond its deadline.");
        if (
          changesTime &&
          state.studyBlocks.some(
            (b) =>
              !b.cancelledAt &&
              b.id !== existing?.id &&
              Date.parse(b.start) < end &&
              Date.parse(b.end) > start,
          )
        )
          throw Error("This time overlaps another saved block.");
        entityId = existing?.id ?? randomUUID();
        const block: StudyBlock = {
          id: entityId,
          taskId,
          start: c.input.start,
          end: new Date(end).toISOString(),
          minutes: c.input.minutes,
          why: existing?.why ?? "Time reserved by you.",
          locked: c.type === "block.update" ? c.locked : false,
          origin: "manual",
          revision: (existing?.revision ?? -1) + 1,
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp,
        };
        this.db
          .prepare(
            "INSERT INTO study_blocks VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
          )
          .run(entityId, taskId, JSON.stringify(block));
      }
      if (c.type === "canvas.create") {
        const task = state.tasks.find((t) => t.id === c.taskId);
        if (!task) throw Error("Assignment no longer exists.");
        entityId = randomUUID();
        const blank = {
          engine: "excalidraw" as const,
          version: 1 as const,
          elements: [],
          files: {},
          viewBackgroundColor: "#ffffff",
        };
        const scene = c.notebook ? startNotebook(blank, randomUUID()) : blank;
        this.db
          .prepare("INSERT INTO canvases VALUES(?,?,?,?,?,?,?)")
          .run(
            entityId,
            task.id,
            c.notebook ? `${task.title} notebook` : task.title,
            timestamp,
            timestamp,
            0,
            JSON.stringify(scene),
          );
      }
      if (c.type === "canvas.save" || c.type === "canvas.recover") {
        for (const sourceId of c.scene.sourceIds ?? []) {
          if (!state.sources.some((source) => source.id === sourceId))
            throw Error("A linked source no longer exists.");
        }
      }
      if (c.type === "canvas.recover") {
        const original = this.canvas(c.id);
        entityId = randomUUID();
        this.db
          .prepare("INSERT INTO canvases VALUES(?,?,?,?,?,?,?)")
          .run(
            entityId,
            original.taskId,
            original.title + " (recovery copy)",
            timestamp,
            timestamp,
            0,
            JSON.stringify(c.scene),
          );
      }
      if (c.type === "canvas.save") {
        const result = this.db
          .prepare(
            "UPDATE canvases SET scene=?,revision=revision+1,updatedAt=? WHERE id=? AND revision=?",
          )
          .run(JSON.stringify(c.scene), timestamp, c.id, c.revision);
        if (!result.changes)
          throw Error(
            "This canvas changed elsewhere. Reopen it before saving.",
          );
        entityId = c.id;
      }
      if (c.type === "source.create") {
        entityId = randomUUID();
        this.db
          .prepare("INSERT INTO sources VALUES(?,?,?,?,?)")
          .run(
            entityId,
            c.input.title,
            c.input.text,
            timestamp,
            "user-provided-text",
          );
        for (const classId of new Set(c.input.classIds))
          this.db
            .prepare("INSERT INTO source_classes VALUES(?,?)")
            .run(entityId, classId);
        for (const taskId of new Set(c.input.taskIds))
          this.db
            .prepare("INSERT INTO source_tasks VALUES(?,?)")
            .run(entityId, taskId);
      }
      if (c.type === "planning.preferences") {
        entityId = "planning";
        this.db
          .prepare(
            "INSERT INTO settings VALUES('planning',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
          )
          .run(JSON.stringify(c.input));
      }
      if (c.type === "class.create") {
        entityId = randomUUID();
        this.db
          .prepare("INSERT INTO classes VALUES(?,?,?)")
          .run(entityId, c.name, "#50705A");
      }
      if (
        (c.type === "task.create" || c.type === "task.update") &&
        c.input.gradeContext
      ) {
        const category = state.gradeCategories.find(
          (category) => category.id === c.input.gradeContext!.categoryId,
        );
        if (!category || category.classId !== c.input.classId)
          throw Error(
            "Choose a grade category belonging to this assignment's class.",
          );
      }
      if (c.type === "checklist.add" || c.type === "checklist.update") {
        const task = state.tasks.find((t) => t.id === c.taskId);
        if (!task) throw Error("Task no longer exists.");
        if (task.completed)
          throw Error("Reopen the task before changing its checklist.");
        const items = task.checklist ?? [];
        if (c.type === "checklist.add") {
          if (items.length >= 100)
            throw Error(
              "This task already has 100 checklist items, including archived items.",
            );
          const item = {
            id: randomUUID(),
            title: c.title,
            completed: false,
            archived: false,
            revision: 0,
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          task.checklist = [...items, item];
          task.revision = (task.revision ?? 0) + 1;
        } else {
          const item = items.find((item) => item.id === c.id);
          if (!item || item.revision !== c.revision)
            throw Error(
              "This checklist item changed. Close the editor and try again.",
            );
          if (
            item.title !== c.input.title ||
            item.archived !== c.input.archived
          )
            task.revision = (task.revision ?? 0) + 1;
          Object.assign(item, c.input, {
            revision: item.revision + 1,
            updatedAt: timestamp,
          });
        }
        entityId = task.id;
        this.db
          .prepare("UPDATE tasks SET data=? WHERE id=?")
          .run(JSON.stringify(task), task.id);
      }
      if (c.type === "task.create") {
        entityId = randomUUID();
        const task: Task = {
          ...c.input,
          id: entityId,
          completed: false,
          revision: 0,
          createdAt: timestamp,
          ...(active &&
          state.planningMode === "auto-plan" &&
          c.input.deadlineConfirmed
            ? { autoPlanPending: true }
            : {}),
        };
        this.db
          .prepare("INSERT INTO tasks VALUES(?,?,?)")
          .run(entityId, task.classId, JSON.stringify(task));
        if (!active) this.reserveCapturedTask(task, now);
      }
      if (c.type === "task.update") {
        const existing = state.tasks.find((t) => t.id === c.id);
        if (!existing) throw Error("Task no longer exists.");
        const changesAuthority =
          existing.deadlineConfirmed &&
          (existing.dueAt !== c.input.dueAt || !c.input.deadlineConfirmed);
        if (changesAuthority && !c.deadlineChangeApproved)
          throw Error(
            "Approve the change to this confirmed deadline before saving.",
          );
        const updated: Task = {
          ...existing,
          ...c.input,
          revision: (existing.revision ?? 0) + 1,
          captureEvidence: existing.captureEvidence ?? c.input.captureEvidence,
        };
        entityId = existing.id;
        this.db
          .prepare("UPDATE tasks SET class_id=?,data=? WHERE id=?")
          .run(updated.classId, JSON.stringify(updated), existing.id);
      }
      if (c.type === "task.undo") {
        const taskBlocks = state.studyBlocks.filter((b) => b.taskId === c.id);
        if (
          taskBlocks.some(
            (b) =>
              b.origin !== "auto-plan" ||
              b.revision !== 0 ||
              b.locked ||
              b.cancelledAt,
          )
        )
          throw Error("This task has saved study blocks and cannot be undone.");
        if (state.tasks.find((t) => t.id === c.id)?.checklist?.length)
          throw Error("This task has checklist work and cannot be undone.");
        if (state.sessions.some((s) => s.taskId === c.id))
          throw Error("This task has study history and cannot be undone.");
        if (!state.tasks.some((t) => t.id === c.id))
          throw Error("Task no longer exists.");
        entityId = c.id;
        this.db.prepare("DELETE FROM study_blocks WHERE task_id=?").run(c.id);
        this.db.prepare("DELETE FROM tasks WHERE id=?").run(c.id);
      }
      if (c.type === "session.start") {
        if (active) throw Error("End the current study session first.");
        const task = state.tasks.find((t) => t.id === c.taskId);
        if (!task || task.completed) throw Error("Choose an unfinished task.");
        entityId = randomUUID();
        const session: StudySession = {
          id: entityId,
          taskId: c.taskId,
          startedAt: timestamp,
          pausedAt: null,
          pausedMs: 0,
          endedAt: null,
          actualMinutes: null,
          estimateAtStart: {
            minutes: task.minutes,
            classId: task.classId,
            workKind: task.workKind ?? "assignment",
            taskRevision: task.revision ?? 0,
          },
        };
        this.db
          .prepare("INSERT INTO sessions VALUES(?,?,?,1)")
          .run(entityId, c.taskId, JSON.stringify(session));
      }
      if (["session.pause", "session.resume", "session.end"].includes(c.type)) {
        if (!active) throw Error("No active study session.");
        entityId = active.id;
        if (c.type === "session.pause" && !active.pausedAt)
          active.pausedAt = timestamp;
        if (c.type === "session.resume" && active.pausedAt) {
          active.pausedMs += Math.max(0, +now - Date.parse(active.pausedAt));
          active.pausedAt = null;
        }
        if (c.type === "session.end") {
          const lastActive = active.pausedAt
            ? Date.parse(active.pausedAt)
            : +now;
          active.actualMinutes = Math.max(
            0,
            (lastActive - Date.parse(active.startedAt) - active.pausedMs) /
              60000,
          );
          active.endedAt = timestamp;
          active.completionReported = c.completed;
          const task = state.tasks.find((t) => t.id === active.taskId)!;
          active.checklistAtEnd = (task.checklist ?? [])
            .filter((item) => !item.archived)
            .map(({ id, title, completed }) => ({ id, title, completed }));
          // Completion is the student's explicit report, never a claim of submission or mastery.
          if (c.completed) {
            task.completed = true;
            this.db
              .prepare("UPDATE tasks SET data=? WHERE id=?")
              .run(JSON.stringify(task), task.id);
            this.queue(task.id, "task.complete", timestamp);
          }
        }
        this.db
          .prepare("UPDATE sessions SET data=?,active=? WHERE id=?")
          .run(JSON.stringify(active), active.endedAt ? 0 : 1, active.id);
        if (c.type === "session.end")
          for (const task of this.snapshot().tasks.filter(
            (t) => t.autoPlanPending,
          ))
            this.reserveCapturedTask(task, now);
      }
      if (c.type === "session.correct") {
        const session = state.sessions.find((s) => s.id === c.id);
        if (!session?.endedAt)
          throw Error("End this session before correcting it.");
        const task = state.tasks.find((t) => t.id === session.taskId)!;
        if (
          (session.revision ?? 0) !== c.revision ||
          (task.revision ?? 0) !== c.taskRevision
        )
          throw Error(
            "This task or review changed. Close and reopen the correction.",
          );
        if (
          state.sessions.filter((s) => s.taskId === task.id).at(-1)?.id !==
          session.id
        )
          throw Error(
            "A newer session exists. Correct the latest session instead.",
          );
        if (c.completed && c.remainingMinutes !== null)
          throw Error("Completed work cannot have remaining study time.");
        if (!c.completed && c.remainingMinutes === null)
          throw Error("Enter the minutes still needed for unfinished work.");
        session.corrections = [
          ...(session.corrections ?? []),
          {
            correctedAt: timestamp,
            fromCompleted: session.completionReported ?? null,
            toCompleted: c.completed,
            previousReview: session.review ?? null,
            remainingMinutes: c.remainingMinutes,
          },
        ];
        session.completionReported = c.completed;
        session.review = {
          reviewedAt: timestamp,
          notes: c.notes,
          remainingMinutes: c.remainingMinutes,
        };
        session.revision = (session.revision ?? 0) + 1;
        task.completed = c.completed;
        if (c.remainingMinutes !== null) {
          task.minutes = c.remainingMinutes;
          task.revision = (task.revision ?? 0) + 1;
        }
        entityId = session.id;
        this.db
          .prepare("UPDATE sessions SET data=? WHERE id=?")
          .run(JSON.stringify(session), session.id);
        this.db
          .prepare("UPDATE tasks SET data=? WHERE id=?")
          .run(JSON.stringify(task), task.id);
        this.queue(task.id, "task.completion-corrected", timestamp);
      }
      if (c.type === "session.review") {
        const session = state.sessions.find((s) => s.id === c.id);
        if (!session?.endedAt)
          throw Error("End this session before reviewing it.");
        const task = state.tasks.find((t) => t.id === session.taskId)!;
        if (c.remainingMinutes !== null) {
          if (task.completed)
            throw Error("Completed work cannot have remaining study time.");
          if (
            state.sessions.some(
              (s) =>
                s.taskId === task.id &&
                s.id !== session.id &&
                s.startedAt >= session.endedAt!,
            )
          )
            throw Error(
              "A newer session exists. Update the assignment estimate directly.",
            );
          task.minutes = c.remainingMinutes;
          task.revision = (task.revision ?? 0) + 1;
          this.db
            .prepare("UPDATE tasks SET data=? WHERE id=?")
            .run(JSON.stringify(task), task.id);
          this.queue(task.id, "task.remaining-time", timestamp);
        }
        session.revision = (session.revision ?? 0) + 1;
        session.review = {
          reviewedAt: timestamp,
          notes: c.notes,
          remainingMinutes: c.remainingMinutes,
        };
        entityId = session.id;
        this.db
          .prepare("UPDATE sessions SET data=? WHERE id=?")
          .run(JSON.stringify(session), session.id);
      }
      this.queue(entityId, c.type, timestamp);
      this.db.exec("COMMIT");
      if (c.type === "planning.rebalance") this.rebalance = undefined;
      return this.snapshot();
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  /** Called only inside a command transaction; consumes deferred intent once. */
  private reserveCapturedTask(task: Task, now: Date) {
    const timestamp = now.toISOString();
    const ready = { ...task };
    delete ready.autoPlanPending;
    if (task.autoPlanPending) {
      this.db
        .prepare("UPDATE tasks SET data=? WHERE id=?")
        .run(JSON.stringify(ready), task.id);
      this.queue(task.id, "task.auto-plan-resumed", timestamp);
    }
    const state = this.snapshot();
    if (
      state.planningMode !== "auto-plan" ||
      state.sessions.some((s) => !s.endedAt) ||
      !ready.deadlineConfirmed ||
      ready.completed ||
      state.studyBlocks.some((b) => b.taskId === task.id)
    )
      return;
    const result = planWeek(
      [ready],
      new Date(+now + 180000),
      state.planning,
      state.studyBlocks,
      state,
    );
    const added: StudyBlock[] = result.blocks.map((block) => ({
      ...block,
      id: randomUUID(),
      origin: "auto-plan",
      locked: false,
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
    for (const block of added) {
      this.db
        .prepare("INSERT INTO study_blocks VALUES(?,?,?)")
        .run(block.id, block.taskId, JSON.stringify(block));
      this.queue(block.id, "block.auto-plan", timestamp);
    }
    if (added.length) {
      const change: PlanChange = {
        id: randomUUID(),
        createdAt: timestamp,
        expiresAt: timestamp,
        appliedAt: timestamp,
        reason: `Auto-plan: ${task.title}`,
        added,
        replaced: [],
        kept: [],
        unscheduled: result.unscheduled,
      };
      this.db
        .prepare("INSERT INTO plan_changes VALUES(?,?,?)")
        .run(change.id, timestamp, JSON.stringify(change));
    }
  }
  private queue(id: string, operation: string, at: string) {
    this.db
      .prepare("INSERT INTO outbox VALUES(?,?,?,?)")
      .run(randomUUID(), id, operation, at);
  }
  canvas(id: string): CanvasRecord {
    const row = this.db.prepare("SELECT * FROM canvases WHERE id=?").get(id);
    if (!row) throw Error("Canvas no longer exists.");
    return { ...row, scene: JSON.parse(row.scene as string) } as CanvasRecord;
  }
  close() {
    this.db.close();
  }
}
