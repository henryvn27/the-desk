import type { LensTelemetryEvent } from "../intelligence/lens-provider";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  command,
  type Command,
  type Snapshot,
  type Task,
  type Class,
  type StudySession,
} from "./contracts";
export class DeskStore {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;");
    const version = (
      this.db.prepare("PRAGMA user_version").get() as { user_version: number }
    ).user_version;
    if (version > 2) {
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
  }
  recordAI(event: LensTelemetryEvent, sessionId: string | null) {
    this.db
      .prepare("INSERT INTO ai_runs VALUES(?,?,?,?,?)")
      .run(randomUUID(), "local", sessionId, "lens", JSON.stringify(event));
  }
  snapshot(): Snapshot {
    return {
      classes: this.db.prepare("SELECT * FROM classes").all() as Class[],
      tasks: this.db
        .prepare("SELECT data FROM tasks")
        .all()
        .map((r) => JSON.parse(r.data as string) as Task),
      sessions: this.db
        .prepare("SELECT data FROM sessions")
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
      if (c.type === "class.create") {
        entityId = randomUUID();
        this.db
          .prepare("INSERT INTO classes VALUES(?,?,?)")
          .run(entityId, c.name, "#50705A");
      }
      if (c.type === "task.create") {
        entityId = randomUUID();
        const task: Task = {
          ...c.input,
          id: entityId,
          completed: false,
          createdAt: timestamp,
        };
        this.db
          .prepare("INSERT INTO tasks VALUES(?,?,?)")
          .run(entityId, task.classId, JSON.stringify(task));
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
          captureEvidence: existing.captureEvidence ?? c.input.captureEvidence,
        };
        entityId = existing.id;
        this.db
          .prepare("UPDATE tasks SET class_id=?,data=? WHERE id=?")
          .run(updated.classId, JSON.stringify(updated), existing.id);
      }
      if (c.type === "task.undo") {
        if (state.sessions.some((s) => s.taskId === c.id))
          throw Error("This task has study history and cannot be undone.");
        if (!state.tasks.some((t) => t.id === c.id))
          throw Error("Task no longer exists.");
        entityId = c.id;
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
          const task = state.tasks.find((t) => t.id === active.taskId)!;
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
      }
      this.queue(entityId, c.type, timestamp);
      this.db.exec("COMMIT");
      return this.snapshot();
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  private queue(id: string, operation: string, at: string) {
    this.db
      .prepare("INSERT INTO outbox VALUES(?,?,?,?)")
      .run(randomUUID(), id, operation, at);
  }
  close() {
    this.db.close();
  }
}
