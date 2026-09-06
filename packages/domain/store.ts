import { durationMemories } from "../learning/memory";
import { tutoringMode } from "../intelligence/tutoring";
import { decideCapture } from "../intelligence/capture-policy";
import { interpretCapture } from "../intelligence/capture";
import { planWeek } from "../planner";
import { startNotebook } from "../canvas/notebook";
import type { LensTelemetryEvent } from "../intelligence/lens-provider";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  command,
  capturePolicy,
  type TaskInput,
  defaultPlanningPreferences,
  planningPreferences,
  type Command,
  type CaptureInboxItem,
  type GradeCategory,
  type GradeEntry,
  type Assessment,
  type AcademicPeriod,
  type Space,
  type User,
  type Track,
  type Unit,
  type Teacher,
  type TeacherEvidence,
  type AuthorityClaim,
  type AuthorityResolution,
  type RebalancePreview,
  type PlanChange,
  type StudyBlock,
  type Snapshot,
  type Task,
  type Class,
  type StudySession,
  type Source,
  type CanvasRecord,
  type Mistake,
  type Concept,
  type Attempt,
  type Plan,
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
    if (version > 36) {
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
    if (version <= 17)
      this.db.exec(
        "BEGIN; CREATE TABLE capture_inbox(id TEXT PRIMARY KEY,data TEXT NOT NULL); PRAGMA user_version=18; COMMIT;",
      );
    if (version <= 18) this.db.exec("BEGIN; PRAGMA user_version=19; COMMIT;");
    if (version <= 19) this.db.exec("BEGIN; PRAGMA user_version=20; COMMIT;");
    if (version <= 20) this.db.exec("BEGIN; PRAGMA user_version=21; COMMIT;");
    if (version <= 21)
      this.db.exec(
        "BEGIN; ALTER TABLE sources ADD COLUMN kind TEXT NOT NULL DEFAULT 'unspecified'; ALTER TABLE sources ADD COLUMN revision INTEGER NOT NULL DEFAULT 0; PRAGMA user_version=22; COMMIT;",
      );
    if (version <= 22)
      this.db.exec(
        "BEGIN; CREATE TABLE memories(id TEXT PRIMARY KEY,data TEXT NOT NULL); PRAGMA user_version=23; COMMIT;",
      );
    if (version <= 23) this.db.exec("BEGIN; PRAGMA user_version=24; COMMIT;");
    if (version <= 24) this.db.exec("BEGIN; PRAGMA user_version=25; COMMIT;");
    if (version <= 25)
      this.db.exec(
        "BEGIN; CREATE TABLE IF NOT EXISTS mistakes(id TEXT PRIMARY KEY,data TEXT NOT NULL); PRAGMA user_version=26; COMMIT;",
      );
    if (version <= 26)
      this.db.exec(
        "BEGIN; CREATE TABLE IF NOT EXISTS concepts(id TEXT PRIMARY KEY,data TEXT NOT NULL); PRAGMA user_version=27; COMMIT;",
      );
    if (version <= 27)
      this.db.exec(
        "BEGIN; CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,data TEXT NOT NULL); PRAGMA user_version=28; COMMIT;",
      );
    if (version <= 28)
      this.db.exec(
        "BEGIN; CREATE TABLE IF NOT EXISTS assessments(id TEXT PRIMARY KEY,class_id TEXT NOT NULL REFERENCES classes(id),data TEXT NOT NULL); PRAGMA user_version=29; COMMIT;",
      );
    if (version <= 29)
      this.db.exec(
        "BEGIN; CREATE TABLE IF NOT EXISTS teacher_evidence(id TEXT PRIMARY KEY,class_id TEXT NOT NULL REFERENCES classes(id),assessment_id TEXT REFERENCES assessments(id) ON DELETE SET NULL,task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,data TEXT NOT NULL); PRAGMA user_version=30; COMMIT;",
      );
    if (version <= 30)
      this.db.exec(`BEGIN;
      CREATE TABLE IF NOT EXISTS authority_claims(id TEXT PRIMARY KEY,class_id TEXT NOT NULL REFERENCES classes(id),task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS authority_resolutions(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,fact TEXT NOT NULL,claim_id TEXT NOT NULL REFERENCES authority_claims(id),data TEXT NOT NULL,UNIQUE(task_id,fact));
      PRAGMA user_version=31; COMMIT;`);
    if (version <= 31)
      this.db.exec(`BEGIN;
      CREATE TABLE IF NOT EXISTS teachers(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS teacher_classes(teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,PRIMARY KEY(teacher_id,class_id));
      PRAGMA user_version=32; COMMIT;`);
    if (version <= 32)
      this.db.exec(`BEGIN;
      CREATE TABLE IF NOT EXISTS tracks(id TEXT PRIMARY KEY,class_id TEXT NOT NULL REFERENCES classes(id),data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS units(id TEXT PRIMARY KEY,class_id TEXT NOT NULL REFERENCES classes(id),track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL,data TEXT NOT NULL);
      PRAGMA user_version=33; COMMIT;`);
    if (version <= 33)
      this.db.exec(`BEGIN;
      CREATE TABLE IF NOT EXISTS academic_periods(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS period_classes(period_id TEXT NOT NULL REFERENCES academic_periods(id) ON DELETE CASCADE,class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,PRIMARY KEY(period_id,class_id));
      CREATE TABLE IF NOT EXISTS spaces(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS space_classes(space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,PRIMARY KEY(space_id,class_id));
      PRAGMA user_version=34; COMMIT;`);
    if (version <= 34)
      this.db.exec(`BEGIN;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      PRAGMA user_version=35; COMMIT;`);
    if (version <= 35)
      this.db.exec(`BEGIN;
      CREATE TABLE IF NOT EXISTS plans(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      PRAGMA user_version=36; COMMIT;`);
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
      state.assessments,
      state.mistakes,
      state.concepts,
      state.attempts,
    ]);
  }
  private savePlanVersion(
    state: Snapshot,
    now: Date,
    trigger: Plan["trigger"],
    blockIds: string[],
    unscheduled: Plan["unscheduled"],
  ) {
    const createdAt = now.toISOString();
    const basis = this.planningBasis(state);
    const plan: Plan = {
      id: randomUUID(),
      revision: 0,
      createdAt,
      horizonStart: createdAt,
      horizonEnd: new Date(+now + 7 * 24 * 60 * 60 * 1000).toISOString(),
      mode: state.planningMode,
      trigger,
      blockIds: [...blockIds],
      unscheduled: [...unscheduled],
      overloadMinutes: unscheduled.reduce(
        (total, item) => total + item.minutes,
        0,
      ),
      basisHash: createHash("sha256").update(basis).digest("hex"),
      authority: "computed",
    };
    this.db
      .prepare("INSERT INTO plans VALUES(?,?)")
      .run(plan.id, JSON.stringify(plan));
  }
  recordAI(event: LensTelemetryEvent, sessionId: string | null) {
    const userId =
      this.db.prepare("SELECT id FROM users ORDER BY rowid LIMIT 1").get()
        ?.id ?? "local";
    this.db
      .prepare("INSERT INTO ai_runs VALUES(?,?,?,?,?)")
      .run(randomUUID(), userId, sessionId, "lens", JSON.stringify(event));
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
    const user = this.db
      .prepare("SELECT data FROM users ORDER BY rowid LIMIT 1")
      .get();
    return {
      user: user ? (JSON.parse(user.data as string) as User) : null,
      mistakes: this.db
        .prepare("SELECT data FROM mistakes ORDER BY rowid")
        .all()
        .map((row) => JSON.parse(row.data as string) as Mistake),
      inference: JSON.parse(
        String(
          this.db
            .prepare("SELECT data FROM settings WHERE id='inference'")
            .get()?.data ?? '{"enabled":true,"excludedSessionIds":[]}',
        ),
      ),
      memories: this.db
        .prepare("SELECT data FROM memories ORDER BY rowid")
        .all()
        .map((row) => JSON.parse(row.data as string)),
      tutoringMode: tutoringMode.parse(
        JSON.parse(
          String(
            this.db
              .prepare("SELECT data FROM settings WHERE id='tutor-mode'")
              .get()?.data ?? '"balanced"',
          ),
        ),
      ),
      capturePolicy: capturePolicy.parse(
        JSON.parse(
          String(
            this.db
              .prepare("SELECT data FROM settings WHERE id='capture-policy'")
              .get()?.data ?? '"balanced"',
          ),
        ),
      ),
      captureInbox: this.db
        .prepare("SELECT data FROM capture_inbox ORDER BY rowid")
        .all()
        .map((r) => JSON.parse(r.data as string) as CaptureInboxItem),
      planningMode: mode === '"suggest"' ? "suggest" : "auto-plan",
      gradeCategories: this.db
        .prepare("SELECT data FROM grade_categories")
        .all()
        .map((r) => JSON.parse(r.data as string) as GradeCategory),
      gradeEntries: this.db
        .prepare("SELECT data FROM grade_entries")
        .all()
        .map((r) => JSON.parse(r.data as string) as GradeEntry),
      assessments: this.db
        .prepare("SELECT data FROM assessments ORDER BY rowid")
        .all()
        .map((row) => JSON.parse(row.data as string) as Assessment),
      academicPeriods: this.db
        .prepare("SELECT data FROM academic_periods ORDER BY rowid")
        .all()
        .map((row) => {
          const period = JSON.parse(row.data as string) as AcademicPeriod;
          period.classIds = this.db
            .prepare(
              "SELECT class_id FROM period_classes WHERE period_id=? ORDER BY rowid",
            )
            .all(period.id)
            .map((link) => link.class_id as string);
          return period;
        }),
      spaces: this.db
        .prepare("SELECT data FROM spaces ORDER BY rowid")
        .all()
        .map((row) => {
          const space = JSON.parse(row.data as string) as Space;
          space.classIds = this.db
            .prepare(
              "SELECT class_id FROM space_classes WHERE space_id=? ORDER BY rowid",
            )
            .all(space.id)
            .map((link) => link.class_id as string);
          return space;
        }),
      tracks: this.db
        .prepare("SELECT data FROM tracks ORDER BY rowid")
        .all()
        .map((row) => JSON.parse(row.data as string) as Track),
      units: this.db
        .prepare("SELECT data FROM units ORDER BY rowid")
        .all()
        .map((row) => JSON.parse(row.data as string) as Unit),
      teachers: this.db
        .prepare("SELECT data FROM teachers ORDER BY rowid")
        .all()
        .map((row) => JSON.parse(row.data as string) as Teacher),
      teacherEvidence: this.db
        .prepare("SELECT data FROM teacher_evidence ORDER BY rowid")
        .all()
        .map((row) => JSON.parse(row.data as string) as TeacherEvidence),
      authorityClaims: this.db
        .prepare("SELECT data FROM authority_claims ORDER BY rowid")
        .all()
        .map((row) => JSON.parse(row.data as string) as AuthorityClaim),
      authorityResolutions: this.db
        .prepare("SELECT data FROM authority_resolutions ORDER BY rowid")
        .all()
        .map((row) => JSON.parse(row.data as string) as AuthorityResolution),
      concepts: this.db
        .prepare("SELECT data FROM concepts ORDER BY rowid")
        .all()
        .map((row) => JSON.parse(row.data as string) as Concept),
      attempts: this.db
        .prepare("SELECT data FROM attempts ORDER BY rowid")
        .all()
        .map((row) => JSON.parse(row.data as string) as Attempt),
      plans: this.db
        .prepare("SELECT data FROM plans ORDER BY rowid DESC LIMIT 50")
        .all()
        .map((row) => JSON.parse(row.data as string) as Plan),
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
      if (c.type === "tutor.mode") {
        entityId = "tutor-mode";
        this.db
          .prepare(
            "INSERT INTO settings VALUES('tutor-mode',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
          )
          .run(JSON.stringify(c.mode));
      }
      if (c.type === "capture.policy") {
        entityId = "capture-policy";
        this.db
          .prepare(
            "INSERT INTO settings VALUES('capture-policy',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
          )
          .run(JSON.stringify(c.mode));
      }
      if (c.type === "inbox.capture" || c.type === "inbox.import") {
        const context = { classes: state.classes, now, timeZone: c.timeZone };
        const drafts =
          c.type === "inbox.capture"
            ? interpretCapture(c.text, context)
            : c.files.flatMap((file) =>
                interpretCapture(file.text, context).map((draft) => ({
                  ...draft,
                  provenance: {
                    ...draft.provenance,
                    source: "text-file" as const,
                    sourceName: file.name,
                  },
                })),
              );
        if (
          !drafts.length ||
          drafts.length > 50 ||
          state.captureInbox.filter((i) => i.status === "pending").length +
            drafts.length >
            500
        )
          throw Error(
            "Capture up to 50 items at once and review your pending inbox before adding more.",
          );
        for (const draft of drafts) {
          entityId = randomUUID();
          const decision = decideCapture(
            draft,
            state.capturePolicy,
            this.snapshot().tasks,
            now,
          );
          const item: CaptureInboxItem = {
            filing: {
              policy: state.capturePolicy,
              action: decision.action,
              reason: decision.reason,
            },
            id: entityId,
            revision: 0,
            status: "pending",
            taskId: null,
            draft,
            updatedAt: timestamp,
          };
          this.db
            .prepare("INSERT INTO capture_inbox VALUES(?,?)")
            .run(entityId, JSON.stringify(item));
          this.queue(entityId, "inbox.created", timestamp);
          if (decision.action === "auto-file") {
            const task = this.createCapturedTask(
              decision.input,
              state,
              now,
              item,
            );
            this.queue(task.id, "task.auto-file", timestamp);
          }
        }
      }
      if (c.type === "inbox.archive") {
        const item = state.captureInbox.find((i) => i.id === c.id);
        if (!item || item.revision !== c.revision || item.status === "accepted")
          throw Error("This capture changed. Reopen the inbox and try again.");
        entityId = item.id;
        this.db.prepare("UPDATE capture_inbox SET data=? WHERE id=?").run(
          JSON.stringify({
            ...item,
            status: c.archived ? "archived" : "pending",
            revision: item.revision + 1,
            updatedAt: timestamp,
          }),
          item.id,
        );
      }
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
      if (
        c.type === "assessment.create" ||
        c.type === "assessment.update" ||
        c.type === "assessment.forget"
      ) {
        const previous =
          c.type === "assessment.create"
            ? undefined
            : state.assessments.find((assessment) => assessment.id === c.id);
        if (
          c.type !== "assessment.create" &&
          (!previous || previous.revision !== c.revision)
        )
          throw Error(
            "This assessment changed elsewhere. Reopen it before saving.",
          );
        const input = c.type === "assessment.forget" ? undefined : c.input;
        const classId = input?.classId ?? previous?.classId;
        if (!classId || !state.classes.some((course) => course.id === classId))
          throw Error("Choose an existing class for this assessment.");
        if (
          input?.taskIds.some(
            (taskId) =>
              !state.tasks.some(
                (task) => task.id === taskId && task.classId === classId,
              ),
          )
        )
          throw Error("Every linked task must belong to the selected class.");
        if (
          input?.gradeCategoryId &&
          !state.gradeCategories.some(
            (category) =>
              category.id === input.gradeCategoryId &&
              category.classId === classId,
          )
        )
          throw Error(
            "The linked grade category must belong to the selected class.",
          );
        if (
          input &&
          state.assessments.some(
            (assessment) =>
              assessment.id !== previous?.id &&
              assessment.classId === classId &&
              assessment.title.toLowerCase() === input.title.toLowerCase(),
          )
        )
          throw Error(
            "An assessment with this title already exists in the class.",
          );
        entityId = previous?.id ?? randomUUID();
        if (input) {
          const assessment: Assessment = {
            ...input,
            taskIds: [...new Set(input.taskIds)],
            id: entityId,
            revision: (previous?.revision ?? -1) + 1,
            createdAt: previous?.createdAt ?? timestamp,
            updatedAt: timestamp,
          };
          this.db
            .prepare(
              "INSERT INTO assessments VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET class_id=excluded.class_id,data=excluded.data",
            )
            .run(entityId, assessment.classId, JSON.stringify(assessment));
        } else {
          this.db.prepare("DELETE FROM assessments WHERE id=?").run(entityId);
        }
      }
      if (
        c.type === "period.create" ||
        c.type === "period.update" ||
        c.type === "period.forget"
      ) {
        const previous =
          c.type === "period.create"
            ? undefined
            : state.academicPeriods.find((period) => period.id === c.id);
        if (
          c.type !== "period.create" &&
          (!previous || previous.revision !== c.revision)
        )
          throw Error(
            "This academic period changed elsewhere. Reopen it before saving.",
          );
        const input = c.type === "period.forget" ? undefined : c.input;
        const classIds = [
          ...new Set(input?.classIds ?? previous?.classIds ?? []),
        ];
        if (
          input &&
          classIds.some(
            (classId) => !state.classes.some((course) => course.id === classId),
          )
        )
          throw Error("Link this academic period only to existing classes.");
        if (
          input &&
          state.academicPeriods.some(
            (period) =>
              period.id !== previous?.id &&
              period.name.toLowerCase() === input.name.toLowerCase(),
          )
        )
          throw Error("An academic period with this name already exists.");
        if (previous && input === undefined && previous.classIds.length > 0)
          throw Error(
            "Unlink this academic period from its classes before forgetting it.",
          );
        entityId = previous?.id ?? randomUUID();
        if (input) {
          const period: AcademicPeriod = {
            ...input,
            classIds,
            id: entityId,
            revision: (previous?.revision ?? -1) + 1,
            authority: "user-entered",
            createdAt: previous?.createdAt ?? timestamp,
            updatedAt: timestamp,
          };
          this.db
            .prepare(
              "INSERT INTO academic_periods VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
            )
            .run(entityId, JSON.stringify(period));
          this.db
            .prepare("DELETE FROM period_classes WHERE period_id=?")
            .run(entityId);
          for (const classId of classIds)
            this.db
              .prepare("INSERT INTO period_classes VALUES(?,?)")
              .run(entityId, classId);
        } else {
          this.db
            .prepare("DELETE FROM academic_periods WHERE id=?")
            .run(entityId);
        }
      }
      if (
        c.type === "space.create" ||
        c.type === "space.update" ||
        c.type === "space.forget"
      ) {
        const previous =
          c.type === "space.create"
            ? undefined
            : state.spaces.find((space) => space.id === c.id);
        if (
          c.type !== "space.create" &&
          (!previous || previous.revision !== c.revision)
        )
          throw Error("This space changed elsewhere. Reopen it before saving.");
        const input = c.type === "space.forget" ? undefined : c.input;
        const classIds = [
          ...new Set(input?.classIds ?? previous?.classIds ?? []),
        ];
        if (
          input &&
          classIds.some(
            (classId) => !state.classes.some((course) => course.id === classId),
          )
        )
          throw Error("Link this space only to existing classes.");
        if (
          input &&
          state.spaces.some(
            (space) =>
              space.id !== previous?.id &&
              space.name.toLowerCase() === input.name.toLowerCase(),
          )
        )
          throw Error("A space with this name already exists.");
        if (previous && input === undefined && previous.classIds.length > 0)
          throw Error(
            "Unlink this space from its classes before forgetting it.",
          );
        entityId = previous?.id ?? randomUUID();
        if (input) {
          const space: Space = {
            ...input,
            classIds,
            id: entityId,
            revision: (previous?.revision ?? -1) + 1,
            authority: "user-entered",
            createdAt: previous?.createdAt ?? timestamp,
            updatedAt: timestamp,
          };
          this.db
            .prepare(
              "INSERT INTO spaces VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
            )
            .run(entityId, JSON.stringify(space));
          this.db
            .prepare("DELETE FROM space_classes WHERE space_id=?")
            .run(entityId);
          for (const classId of classIds)
            this.db
              .prepare("INSERT INTO space_classes VALUES(?,?)")
              .run(entityId, classId);
        } else {
          this.db.prepare("DELETE FROM spaces WHERE id=?").run(entityId);
        }
      }
      if (
        c.type === "track.create" ||
        c.type === "track.update" ||
        c.type === "track.forget"
      ) {
        const previous =
          c.type === "track.create"
            ? undefined
            : state.tracks.find((track) => track.id === c.id);
        if (
          c.type !== "track.create" &&
          (!previous || previous.revision !== c.revision)
        )
          throw Error("This track changed elsewhere. Reopen it before saving.");
        const input = c.type === "track.forget" ? undefined : c.input;
        const classId = input?.classId ?? previous?.classId;
        if (!classId || !state.classes.some((course) => course.id === classId))
          throw Error("Choose an existing class for this track.");
        if (
          input &&
          state.tracks.some(
            (track) =>
              track.id !== previous?.id &&
              track.classId === classId &&
              track.name.toLowerCase() === input.name.toLowerCase(),
          )
        )
          throw Error("A track with this name already exists in the class.");
        if (
          previous &&
          state.units.some(
            (unit) =>
              unit.trackId === previous.id &&
              (input === undefined || unit.classId !== input.classId),
          )
        )
          throw Error(
            "Edit or unlink this track from its units before changing its class or forgetting it.",
          );
        entityId = previous?.id ?? randomUUID();
        if (input) {
          const track: Track = {
            ...input,
            id: entityId,
            revision: (previous?.revision ?? -1) + 1,
            authority: "user-entered",
            createdAt: previous?.createdAt ?? timestamp,
            updatedAt: timestamp,
          };
          this.db
            .prepare(
              "INSERT INTO tracks VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET class_id=excluded.class_id,data=excluded.data",
            )
            .run(entityId, track.classId, JSON.stringify(track));
        } else {
          this.db.prepare("DELETE FROM tracks WHERE id=?").run(entityId);
        }
      }
      if (
        c.type === "unit.create" ||
        c.type === "unit.update" ||
        c.type === "unit.forget"
      ) {
        const previous =
          c.type === "unit.create"
            ? undefined
            : state.units.find((unit) => unit.id === c.id);
        if (
          c.type !== "unit.create" &&
          (!previous || previous.revision !== c.revision)
        )
          throw Error("This unit changed elsewhere. Reopen it before saving.");
        const input = c.type === "unit.forget" ? undefined : c.input;
        const classId = input?.classId ?? previous?.classId;
        if (!classId || !state.classes.some((course) => course.id === classId))
          throw Error("Choose an existing class for this unit.");
        const trackId = input ? input.trackId : (previous?.trackId ?? null);
        if (
          trackId &&
          !state.tracks.some(
            (track) => track.id === trackId && track.classId === classId,
          )
        )
          throw Error("The linked track must belong to the selected class.");
        const taskIds = [...new Set(input?.taskIds ?? previous?.taskIds ?? [])];
        if (
          input &&
          taskIds.some(
            (taskId) =>
              !state.tasks.some(
                (task) => task.id === taskId && task.classId === classId,
              ),
          )
        )
          throw Error("Every linked task must belong to the selected class.");
        if (
          input &&
          state.units.some(
            (unit) =>
              unit.id !== previous?.id &&
              unit.classId === classId &&
              unit.name.toLowerCase() === input.name.toLowerCase(),
          )
        )
          throw Error("A unit with this name already exists in the class.");
        entityId = previous?.id ?? randomUUID();
        if (input) {
          const unit: Unit = {
            ...input,
            trackId,
            taskIds,
            id: entityId,
            revision: (previous?.revision ?? -1) + 1,
            authority: "user-entered",
            createdAt: previous?.createdAt ?? timestamp,
            updatedAt: timestamp,
          };
          this.db
            .prepare(
              "INSERT INTO units VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET class_id=excluded.class_id,track_id=excluded.track_id,data=excluded.data",
            )
            .run(entityId, unit.classId, unit.trackId, JSON.stringify(unit));
        } else {
          this.db.prepare("DELETE FROM units WHERE id=?").run(entityId);
        }
      }
      if (
        c.type === "teacher.create" ||
        c.type === "teacher.update" ||
        c.type === "teacher.forget"
      ) {
        const previous =
          c.type === "teacher.create"
            ? undefined
            : state.teachers.find((teacher) => teacher.id === c.id);
        if (
          c.type !== "teacher.create" &&
          (!previous || previous.revision !== c.revision)
        )
          throw Error(
            "This teacher changed elsewhere. Reopen it before saving.",
          );
        const input = c.type === "teacher.forget" ? undefined : c.input;
        const classIds = [
          ...new Set(input?.classIds ?? previous?.classIds ?? []),
        ];
        if (
          input &&
          (classIds.length === 0 ||
            classIds.some(
              (classId) =>
                !state.classes.some((course) => course.id === classId),
            ))
        )
          throw Error("Link this teacher to at least one existing class.");
        if (
          input &&
          state.teachers.some(
            (teacher) =>
              teacher.id !== previous?.id &&
              teacher.name.toLowerCase() === input.name.toLowerCase() &&
              teacher.classIds.some((classId) => classIds.includes(classId)),
          )
        )
          throw Error(
            "A teacher with this name already exists in one of these classes.",
          );
        if (
          previous &&
          state.teacherEvidence.some(
            (evidence) =>
              evidence.teacherId === previous.id &&
              (input === undefined || !classIds.includes(evidence.classId)),
          )
        )
          throw Error(
            "This teacher has linked evidence. Edit or unlink the evidence before removing that class or forgetting the teacher.",
          );
        entityId = previous?.id ?? randomUUID();
        if (input) {
          const teacher: Teacher = {
            ...input,
            classIds,
            id: entityId,
            revision: (previous?.revision ?? -1) + 1,
            authority: "user-entered",
            createdAt: previous?.createdAt ?? timestamp,
            updatedAt: timestamp,
          };
          this.db
            .prepare(
              "INSERT INTO teachers VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
            )
            .run(entityId, JSON.stringify(teacher));
          this.db
            .prepare("DELETE FROM teacher_classes WHERE teacher_id=?")
            .run(entityId);
          for (const classId of classIds)
            this.db
              .prepare("INSERT INTO teacher_classes VALUES(?,?)")
              .run(entityId, classId);
        } else {
          this.db.prepare("DELETE FROM teachers WHERE id=?").run(entityId);
        }
      }
      if (
        c.type === "evidence.create" ||
        c.type === "evidence.update" ||
        c.type === "evidence.forget"
      ) {
        const previous =
          c.type === "evidence.create"
            ? undefined
            : state.teacherEvidence.find((evidence) => evidence.id === c.id);
        if (
          c.type !== "evidence.create" &&
          (!previous || previous.revision !== c.revision)
        )
          throw Error(
            "This teacher evidence changed elsewhere. Reopen it before saving.",
          );
        const input = c.type === "evidence.forget" ? undefined : c.input;
        const classId = input?.classId ?? previous?.classId;
        if (!classId || !state.classes.some((course) => course.id === classId))
          throw Error("Choose an existing class for this teacher evidence.");
        const teacherId =
          input && Object.prototype.hasOwnProperty.call(input, "teacherId")
            ? (input.teacherId ?? null)
            : (previous?.teacherId ?? null);
        if (
          teacherId &&
          !state.teachers.some(
            (teacher) =>
              teacher.id === teacherId && teacher.classIds.includes(classId),
          )
        )
          throw Error("The linked teacher must teach the selected class.");
        if (
          input?.assessmentId &&
          !state.assessments.some(
            (assessment) =>
              assessment.id === input.assessmentId &&
              assessment.classId === classId,
          )
        )
          throw Error(
            "The linked assessment must belong to the selected class.",
          );
        if (
          input?.taskId &&
          !state.tasks.some(
            (task) => task.id === input.taskId && task.classId === classId,
          )
        )
          throw Error("The linked task must belong to the selected class.");
        const conceptIds = [
          ...new Set(input?.conceptIds ?? previous?.conceptIds ?? []),
        ];
        if (
          conceptIds.some(
            (conceptId) =>
              !state.concepts.some(
                (concept) =>
                  concept.id === conceptId && concept.classId === classId,
              ),
          )
        )
          throw Error(
            "Every linked concept must belong to the selected class.",
          );
        entityId = previous?.id ?? randomUUID();
        if (input) {
          const evidence: TeacherEvidence = {
            ...input,
            teacherId,
            conceptIds,
            id: entityId,
            revision: (previous?.revision ?? -1) + 1,
            authority: "teacher-reported",
            createdAt: previous?.createdAt ?? timestamp,
            updatedAt: timestamp,
          };
          this.db
            .prepare(
              "INSERT INTO teacher_evidence VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET class_id=excluded.class_id,assessment_id=excluded.assessment_id,task_id=excluded.task_id,data=excluded.data",
            )
            .run(
              entityId,
              evidence.classId,
              evidence.assessmentId,
              evidence.taskId,
              JSON.stringify(evidence),
            );
        } else {
          this.db
            .prepare("DELETE FROM teacher_evidence WHERE id=?")
            .run(entityId);
        }
      }
      if (
        c.type === "authority.claim.create" ||
        c.type === "authority.claim.update" ||
        c.type === "authority.claim.forget"
      ) {
        const previous =
          c.type === "authority.claim.create"
            ? undefined
            : state.authorityClaims.find((claim) => claim.id === c.id);
        if (
          c.type !== "authority.claim.create" &&
          (!previous || previous.revision !== c.revision)
        )
          throw Error(
            "This authority claim changed elsewhere. Reopen it before saving.",
          );
        if (
          previous &&
          state.authorityResolutions.some(
            (resolution) => resolution.claimId === previous.id,
          )
        )
          throw Error(
            "Resolve this task with another claim before changing the selected authority claim.",
          );
        const input = c.type === "authority.claim.forget" ? undefined : c.input;
        const task = state.tasks.find(
          (candidate) => candidate.id === (input?.taskId ?? previous?.taskId),
        );
        const classId = input?.classId ?? previous?.classId;
        if (!task || !classId || task.classId !== classId)
          throw Error("Choose an existing task and its class for this claim.");
        if (input?.sourceId) {
          const source = state.sources.find(
            (candidate) => candidate.id === input.sourceId,
          );
          if (
            !source ||
            (!source.classIds.includes(classId) &&
              !source.taskIds.includes(task.id))
          )
            throw Error("The linked source must belong to this class or task.");
        }
        if (input?.evidenceId) {
          const evidence = state.teacherEvidence.find(
            (candidate) => candidate.id === input.evidenceId,
          );
          if (!evidence || evidence.classId !== classId)
            throw Error(
              "The linked teacher evidence must belong to this class.",
            );
          if (evidence.taskId && evidence.taskId !== task.id)
            throw Error(
              "The linked teacher evidence must belong to this task.",
            );
        }
        entityId = previous?.id ?? randomUUID();
        if (input) {
          const claim: AuthorityClaim = {
            ...input,
            id: entityId,
            revision: (previous?.revision ?? -1) + 1,
            createdAt: previous?.createdAt ?? timestamp,
            updatedAt: timestamp,
          };
          this.db
            .prepare(
              "INSERT INTO authority_claims VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET class_id=excluded.class_id,task_id=excluded.task_id,data=excluded.data",
            )
            .run(entityId, claim.classId, claim.taskId, JSON.stringify(claim));
        } else {
          this.db
            .prepare("DELETE FROM authority_claims WHERE id=?")
            .run(entityId);
        }
      }
      if (c.type === "authority.resolve") {
        if (!c.resolutionApproved)
          throw Error("Choose an authority claim before applying a due date.");
        const task = state.tasks.find((candidate) => candidate.id === c.taskId);
        const claim = state.authorityClaims.find(
          (candidate) => candidate.id === c.claimId,
        );
        if (!task || !claim || claim.taskId !== task.id)
          throw Error("Choose a claim belonging to this assignment.");
        if ((task.revision ?? 0) !== c.taskRevision)
          throw Error(
            "This assignment changed elsewhere. Reopen the conflict before resolving it.",
          );
        if (claim.revision !== c.claimRevision)
          throw Error(
            "This authority claim changed elsewhere. Reopen the conflict before resolving it.",
          );
        const updated: Task = {
          ...task,
          dueAt: claim.value,
          deadlineConfirmed: claim.value !== null,
          revision: (task.revision ?? 0) + 1,
        };
        const prior = state.authorityResolutions.find(
          (resolution) =>
            resolution.taskId === task.id && resolution.fact === claim.fact,
        );
        const resolution: AuthorityResolution = {
          id: prior?.id ?? randomUUID(),
          taskId: task.id,
          fact: claim.fact,
          claimId: claim.id,
          claimRevision: claim.revision,
          resolvedAt: timestamp,
          revision: (prior?.revision ?? -1) + 1,
          authority: "user-resolved",
        };
        entityId = task.id;
        this.db
          .prepare("UPDATE tasks SET class_id=?,data=? WHERE id=?")
          .run(updated.classId, JSON.stringify(updated), task.id);
        this.db
          .prepare(
            "INSERT INTO authority_resolutions VALUES(?,?,?,?,?) ON CONFLICT(task_id,fact) DO UPDATE SET id=excluded.id,claim_id=excluded.claim_id,data=excluded.data",
          )
          .run(
            resolution.id,
            resolution.taskId,
            resolution.fact,
            resolution.claimId,
            JSON.stringify(resolution),
          );
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
        this.savePlanVersion(
          state,
          now,
          "rebalance",
          [...preview.kept, ...preview.added].map((block) => block.id),
          preview.unscheduled,
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
      if (c.type === "memory.inference" || c.type === "memory.clear-inferred") {
        entityId = "inference";
        const inference = { ...state.inference };
        if (c.type === "memory.inference") inference.enabled = c.enabled;
        else {
          inference.excludedSessionIds = [
            ...new Set([
              ...inference.excludedSessionIds,
              ...state.sessions.map((session) => session.id),
            ]),
          ];
          for (const memory of state.memories.filter(
            (memory) => memory.origin === "inferred",
          ))
            this.db.prepare("DELETE FROM memories WHERE id=?").run(memory.id);
        }
        this.db
          .prepare(
            "INSERT INTO settings VALUES('inference',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
          )
          .run(JSON.stringify(inference));
      }
      if (
        c.type === "mistake.create" ||
        c.type === "mistake.update" ||
        c.type === "mistake.forget"
      ) {
        const previous =
          c.type === "mistake.create"
            ? undefined
            : state.mistakes.find((mistake) => mistake.id === c.id);
        if (
          c.type !== "mistake.create" &&
          (!previous || previous.revision !== c.revision)
        )
          throw Error(
            "This mistake changed elsewhere. Reopen it before saving.",
          );
        if (c.type !== "mistake.forget") {
          if (!state.classes.some((course) => course.id === c.input.classId))
            throw Error("Choose an existing class for this mistake.");
          if (
            c.input.taskId &&
            !state.tasks.some(
              (task) =>
                task.id === c.input.taskId && task.classId === c.input.classId,
            )
          )
            throw Error("The linked task must belong to the selected class.");
        }
        entityId = previous?.id ?? randomUUID();
        if (c.type === "mistake.forget") {
          this.db.prepare("DELETE FROM mistakes WHERE id=?").run(entityId);
        } else {
          const mistake: Mistake = {
            ...c.input,
            id: entityId,
            revision: (previous?.revision ?? -1) + 1,
            practiceTaskIds: previous?.practiceTaskIds ?? [],
            createdAt: previous?.createdAt ?? timestamp,
            updatedAt: timestamp,
          };
          this.db
            .prepare(
              "INSERT INTO mistakes VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
            )
            .run(entityId, JSON.stringify(mistake));
        }
      }
      if (c.type === "mistake.practice") {
        const mistake = state.mistakes.find((item) => item.id === c.id);
        if (!mistake || mistake.revision !== c.revision)
          throw Error(
            "This mistake changed elsewhere. Reopen it before practicing.",
          );
        const taskId = randomUUID();
        const practice: Task = {
          title: `Practice: ${mistake.concept}`,
          classId: mistake.classId,
          dueAt: null,
          minutes: 20,
          resource: null,
          notes: `Practice generated from mistake ${mistake.id}.\n\nCorrection: ${mistake.correction}\nWhat went wrong: ${mistake.whatWentWrong}`,
          deadlineConfirmed: true,
          workKind: "optional-review",
          importance: "high",
          id: taskId,
          completed: false,
          revision: 0,
          createdAt: timestamp,
        };
        this.db
          .prepare("INSERT INTO tasks VALUES(?,?,?)")
          .run(taskId, practice.classId, JSON.stringify(practice));
        const updated: Mistake = {
          ...mistake,
          practiceTaskIds: [...mistake.practiceTaskIds, taskId],
          revision: mistake.revision + 1,
          updatedAt: timestamp,
        };
        this.db
          .prepare("UPDATE mistakes SET data=? WHERE id=? AND data=?")
          .run(JSON.stringify(updated), mistake.id, JSON.stringify(mistake));
        entityId = taskId;
      }
      if (
        c.type === "concept.create" ||
        c.type === "concept.update" ||
        c.type === "concept.forget"
      ) {
        const previous =
          c.type === "concept.create"
            ? undefined
            : state.concepts.find((concept) => concept.id === c.id);
        if (
          c.type !== "concept.create" &&
          (!previous || previous.revision !== c.revision)
        )
          throw Error(
            "This concept changed elsewhere. Reopen it before saving.",
          );
        entityId = previous?.id ?? randomUUID();
        if (c.type === "concept.forget") {
          this.db.prepare("DELETE FROM concepts WHERE id=?").run(entityId);
        } else {
          if (!state.classes.some((course) => course.id === c.input.classId))
            throw Error("Choose an existing class for this concept.");
          const taskIds = [...new Set(c.input.taskIds)];
          if (
            taskIds.some(
              (taskId) =>
                !state.tasks.some(
                  (task) =>
                    task.id === taskId && task.classId === c.input.classId,
                ),
            )
          )
            throw Error("Every linked task must belong to the selected class.");
          if (
            state.concepts.some(
              (concept) =>
                concept.id !== entityId &&
                concept.classId === c.input.classId &&
                concept.name.toLowerCase() === c.input.name.toLowerCase(),
            )
          )
            throw Error(
              "A concept with this name already exists in the class.",
            );
          const concept: Concept = {
            ...c.input,
            taskIds,
            id: entityId,
            revision: (previous?.revision ?? -1) + 1,
            createdAt: previous?.createdAt ?? timestamp,
            updatedAt: timestamp,
          };
          this.db
            .prepare(
              "INSERT INTO concepts VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
            )
            .run(entityId, JSON.stringify(concept));
        }
      }
      if (
        c.type === "attempt.create" ||
        c.type === "attempt.update" ||
        c.type === "attempt.forget"
      ) {
        const previous =
          c.type === "attempt.create"
            ? undefined
            : state.attempts.find((attempt) => attempt.id === c.id);
        if (
          c.type !== "attempt.create" &&
          (!previous || previous.revision !== c.revision)
        )
          throw Error(
            "This attempt changed elsewhere. Reopen it before saving.",
          );
        const input = c.type === "attempt.forget" ? undefined : c.input;
        const classId = input?.classId ?? previous?.classId;
        if (!classId || !state.classes.some((course) => course.id === classId))
          throw Error("Choose an existing class for this attempt.");
        const taskId = input ? input.taskId : (previous?.taskId ?? null);
        if (
          taskId &&
          !state.tasks.some(
            (task) => task.id === taskId && task.classId === classId,
          )
        )
          throw Error("The linked task must belong to the selected class.");
        const conceptIds = [
          ...new Set(input?.conceptIds ?? previous?.conceptIds ?? []),
        ];
        if (
          conceptIds.some(
            (conceptId) =>
              !state.concepts.some(
                (concept) =>
                  concept.id === conceptId && concept.classId === classId,
              ),
          )
        )
          throw Error(
            "Every linked concept must belong to the selected class.",
          );
        const conceptEdits = new Map(
          state.concepts.map((concept) => [concept.id, { ...concept }]),
        );
        const dirtyConcepts = new Set<string>();
        const applyDelta = (attempt: Attempt, direction: 1 | -1) => {
          const ids = new Set(attempt.conceptIds);
          for (const conceptId of ids) {
            const concept = conceptEdits.get(conceptId);
            if (!concept) continue;
            concept.attempts = Math.max(0, concept.attempts + direction);
            if (attempt.unaided) {
              concept.unaidedTotal = Math.max(
                0,
                concept.unaidedTotal + direction,
              );
              if (attempt.result === "correct")
                concept.unaidedCorrect = Math.max(
                  0,
                  concept.unaidedCorrect + direction,
                );
            }
            concept.hintCount = Math.max(
              0,
              concept.hintCount + direction * attempt.hintCount,
            );
            if (direction === 1) {
              if (
                !concept.lastReviewedAt ||
                Date.parse(attempt.attemptedAt) >
                  Date.parse(concept.lastReviewedAt)
              )
                concept.lastReviewedAt = attempt.attemptedAt;
            } else if (concept.lastReviewedAt === attempt.attemptedAt) {
              concept.lastReviewedAt = null;
            }
            concept.revision += 1;
            concept.updatedAt = timestamp;
            dirtyConcepts.add(concept.id);
          }
        };
        if (previous) applyDelta(previous, -1);
        if (input) {
          const normalized: Attempt = {
            ...input,
            conceptIds,
            id: previous?.id ?? randomUUID(),
            revision: (previous?.revision ?? -1) + 1,
            createdAt: previous?.createdAt ?? timestamp,
            updatedAt: timestamp,
          };
          applyDelta(normalized, 1);
          this.db
            .prepare(
              "INSERT INTO attempts VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
            )
            .run(normalized.id, JSON.stringify(normalized));
          entityId = normalized.id;
        } else {
          this.db.prepare("DELETE FROM attempts WHERE id=?").run(previous!.id);
          entityId = previous!.id;
        }
        for (const conceptId of dirtyConcepts) {
          const concept = conceptEdits.get(conceptId)!;
          this.db
            .prepare("UPDATE concepts SET data=? WHERE id=?")
            .run(JSON.stringify(concept), concept.id);
        }
      }
      if (c.type === "memory.confirm") {
        const candidate = durationMemories(state).find(
          (item) =>
            item.classId === c.classId &&
            item.workKind === c.workKind &&
            item.basis === c.basis,
        );
        if (!candidate)
          throw Error(
            "This pattern changed or learning is disabled. Review the current evidence.",
          );
        if (state.memories.length >= 200)
          throw Error("Forget an old note before adding another memory.");
        entityId = randomUUID();
        const memory = {
          id: entityId,
          text: candidate.text,
          category: "duration",
          classId: c.classId,
          origin: "inferred",
          inferenceKey: candidate.key,
          evidence: candidate.evidence,
          revision: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        this.db
          .prepare("INSERT INTO memories VALUES(?,?)")
          .run(entityId, JSON.stringify(memory));
      }
      if (
        c.type === "memory.create" ||
        c.type === "memory.update" ||
        c.type === "memory.forget"
      ) {
        const previous =
          c.type === "memory.create"
            ? undefined
            : state.memories.find((memory) => memory.id === c.id);
        if (
          c.type !== "memory.create" &&
          (!previous || previous.revision !== c.revision)
        )
          throw Error(
            "This memory changed elsewhere. Reopen it before saving.",
          );
        if (
          c.type !== "memory.forget" &&
          c.input.classId &&
          !state.classes.some((course) => course.id === c.input.classId)
        )
          throw Error("Choose an existing class.");
        if (c.type === "memory.create" && state.memories.length >= 200)
          throw Error(
            "Keep up to 200 memories. Forget an old note before adding another.",
          );
        entityId = previous?.id ?? randomUUID();
        if (c.type === "memory.forget") {
          this.db.prepare("DELETE FROM memories WHERE id=?").run(entityId);
          if (previous?.origin === "inferred")
            this.db
              .prepare(
                "INSERT INTO settings VALUES('inference',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
              )
              .run(
                JSON.stringify({
                  ...state.inference,
                  excludedSessionIds: [
                    ...new Set([
                      ...state.inference.excludedSessionIds,
                      ...(previous.evidence?.sessionIds ?? []),
                    ]),
                  ],
                }),
              );
        } else {
          const memory = {
            ...c.input,
            id: entityId,
            revision: (previous?.revision ?? -1) + 1,
            origin: previous?.origin ?? "explicit",
            ...(previous?.inferenceKey
              ? {
                  inferenceKey: previous.inferenceKey,
                  evidence: previous.evidence,
                }
              : {}),
            createdAt: previous?.createdAt ?? timestamp,
            updatedAt: timestamp,
          };
          this.db
            .prepare(
              "INSERT INTO memories VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
            )
            .run(entityId, JSON.stringify(memory));
        }
      }
      if (c.type === "source.classify") {
        const result = this.db
          .prepare(
            "UPDATE sources SET kind=?,revision=revision+1 WHERE id=? AND revision=?",
          )
          .run(c.kind, c.id, c.revision);
        if (!result.changes)
          throw Error(
            "This source changed elsewhere. Reopen it before saving.",
          );
        entityId = c.id;
      }
      if (c.type === "source.create") {
        entityId = randomUUID();
        this.db
          .prepare("INSERT INTO sources VALUES(?,?,?,?,?,?,?)")
          .run(
            entityId,
            c.input.title,
            c.input.text,
            timestamp,
            "user-provided-text",
            c.input.kind ?? "unspecified",
            0,
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
      if (c.type === "user.create") {
        if (state.user)
          throw Error("A local profile already exists. Edit it instead.");
        entityId = randomUUID();
        const user: User = {
          id: entityId,
          ...c.input,
          revision: 0,
          authority: "user-entered",
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        this.db
          .prepare("INSERT INTO users VALUES(?,?)")
          .run(entityId, JSON.stringify(user));
      }
      if (c.type === "user.update") {
        const existing = state.user;
        if (!existing || existing.id !== c.id)
          throw Error("The local profile no longer exists.");
        if (existing.revision !== c.revision)
          throw Error(
            "The local profile changed elsewhere. Reload and try again.",
          );
        const user: User = {
          ...existing,
          ...c.input,
          revision: existing.revision + 1,
          updatedAt: timestamp,
        };
        entityId = user.id;
        this.db
          .prepare("UPDATE users SET data=? WHERE id=?")
          .run(JSON.stringify(user), user.id);
      }
      if (c.type === "user.forget") {
        const existing = state.user;
        if (!existing || existing.id !== c.id)
          throw Error("The local profile no longer exists.");
        if (existing.revision !== c.revision)
          throw Error(
            "The local profile changed elsewhere. Reload and try again.",
          );
        entityId = existing.id;
        this.db.prepare("DELETE FROM users WHERE id=?").run(existing.id);
      }
      if (c.type === "class.create") {
        entityId = randomUUID();
        this.db
          .prepare("INSERT INTO classes VALUES(?,?,?)")
          .run(entityId, c.name, "#50705A");
      }
      if (
        (c.type === "task.create" ||
          c.type === "task.update" ||
          c.type === "inbox.accept") &&
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
      if (c.type === "task.create" || c.type === "inbox.accept") {
        const item =
          c.type === "inbox.accept"
            ? state.captureInbox.find((i) => i.id === c.id)
            : undefined;
        if (
          c.type === "inbox.accept" &&
          (!item || item.status !== "pending" || item.revision !== c.revision)
        )
          throw Error("This capture changed. Reopen the inbox and try again.");
        entityId = this.createCapturedTask(c.input, state, now, item).id;
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
        if (
          state.units.some(
            (unit) =>
              unit.taskIds.includes(existing.id) &&
              unit.classId !== updated.classId,
          )
        )
          throw Error(
            "Edit or unlink this task from its unit before changing its class.",
          );
        entityId = existing.id;
        this.db
          .prepare("UPDATE tasks SET class_id=?,data=? WHERE id=?")
          .run(updated.classId, JSON.stringify(updated), existing.id);
      }
      if (c.type === "task.undo") {
        if (state.units.some((unit) => unit.taskIds.includes(c.id)))
          throw Error("Unlink this task from its unit before undoing it.");
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
        if ((state.tasks.find((t) => t.id === c.id)?.revision ?? 0) > 0)
          throw Error(
            "This assignment was edited and cannot be undone. Review it in Library.",
          );
        if (!state.tasks.some((t) => t.id === c.id))
          throw Error("Task no longer exists.");
        entityId = c.id;
        this.db.prepare("DELETE FROM study_blocks WHERE task_id=?").run(c.id);
        this.db.prepare("DELETE FROM tasks WHERE id=?").run(c.id);
        for (const item of state.captureInbox.filter(
          (i) => i.taskId === c.id,
        )) {
          this.db.prepare("UPDATE capture_inbox SET data=? WHERE id=?").run(
            JSON.stringify({
              ...item,
              taskId: null,
              status: "pending",
              revision: item.revision + 1,
              updatedAt: timestamp,
            }),
            item.id,
          );
          this.queue(item.id, "inbox.restored", timestamp);
        }
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
    this.savePlanVersion(
      state,
      now,
      "auto-plan",
      added.map((block) => block.id),
      result.unscheduled,
    );
  }
  private createCapturedTask(
    input: TaskInput,
    state: Snapshot,
    now: Date,
    item?: CaptureInboxItem,
  ): Task {
    const entityId = randomUUID();
    const timestamp = now.toISOString();
    const active = state.sessions.find((s) => !s.endedAt);
    const task: Task = {
      ...input,
      ...(item
        ? {
            captureEvidence: {
              source: item.draft.provenance.source,
              ...(item.draft.provenance.sourceName
                ? { sourceName: item.draft.provenance.sourceName }
                : {}),
              originalText: item.draft.provenance.originalText,
              sourceText: item.draft.provenance.sourceText,
              capturedAt: item.draft.provenance.capturedAt,
              authority: item.draft.provenance.authority,
              confidence: item.draft.confidence,
              candidateDates: item.draft.deadline?.candidates ?? [],
              uncertainties: item.draft.uncertainties.map((u) => u.message),
            },
          }
        : {}),
      id: entityId,
      completed: false,
      revision: 0,
      createdAt: timestamp,
      ...(active &&
      state.planningMode === "auto-plan" &&
      input.deadlineConfirmed
        ? { autoPlanPending: true }
        : {}),
    };
    this.db
      .prepare("INSERT INTO tasks VALUES(?,?,?)")
      .run(entityId, task.classId, JSON.stringify(task));
    if (!active) this.reserveCapturedTask(task, now);
    if (item) {
      this.db.prepare("UPDATE capture_inbox SET data=? WHERE id=?").run(
        JSON.stringify({
          ...item,
          taskId: task.id,
          status: "accepted",
          revision: item.revision + 1,
          updatedAt: timestamp,
        }),
        item.id,
      );
      this.queue(item.id, "inbox.accepted", timestamp);
    }
    return task;
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
