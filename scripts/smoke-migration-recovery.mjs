import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const repository = fileURLToPath(new URL("..", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "desk-migration-recovery-"));

function runStore(databasePath, source) {
  const result = spawnSync(
    process.execPath,
    ["--no-warnings", "--import", "tsx", "--input-type=module", "-e", source],
    {
      cwd: repository,
      env: { ...process.env, DESK_FIXTURE_PATH: databasePath },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function schemaVersion(database) {
  return database.prepare("PRAGMA user_version").get().user_version;
}

function outboxColumns(database) {
  return database
    .prepare("PRAGMA table_info(outbox)")
    .all()
    .map((column) => column.name);
}

function rows(statement) {
  return statement.all().map((row) => ({ ...row }));
}

const openAndInspect = `
  import { DeskStore } from "./packages/domain/store.ts";
  const store = new DeskStore(process.env.DESK_FIXTURE_PATH);
  try {
    console.log(JSON.stringify({ snapshot: store.snapshot(), batch: store.syncBatch(100) }));
  } finally {
    store.close();
  }
`;

try {
  const legacyPath = join(directory, "legacy.sqlite");
  const seeded = runStore(
    legacyPath,
    `
      import { DeskStore } from "./packages/domain/store.ts";
      const store = new DeskStore(process.env.DESK_FIXTURE_PATH);
      try {
        const createdAt = new Date("2026-09-06T12:00:00.000Z");
        const course = store.execute(
          { type: "class.create", name: "AP Physics C" },
          createdAt,
        ).classes[0];
        store.execute(
          {
            type: "task.create",
            input: {
              title: "Legacy rotational dynamics set",
              classId: course.id,
              dueAt: "2026-09-10T23:59:00.000Z",
              minutes: 70,
              resource: "https://school.example/physics/rotation",
              notes: "Preserve this exact task payload through migration.",
              deadlineConfirmed: true,
              workKind: "assignment",
              importance: "high",
            },
          },
          new Date("2026-09-06T12:01:00.000Z"),
        );
        console.log(JSON.stringify({ snapshot: store.snapshot(), batch: store.syncBatch(100) }));
      } finally {
        store.close();
      }
    `,
  );

  const legacy = new DatabaseSync(legacyPath);
  const originalClassRows = rows(
    legacy.prepare("SELECT id,name,color FROM classes ORDER BY id"),
  );
  const originalTaskRows = rows(
    legacy.prepare("SELECT id,class_id,data FROM tasks ORDER BY id"),
  );
  const originalOutboxRows = rows(
    legacy.prepare(
      "SELECT id,entity_id,operation,created_at FROM outbox ORDER BY rowid",
    ),
  );
  legacy.exec(`
    PRAGMA foreign_keys=OFF;
    BEGIN;
    ALTER TABLE outbox RENAME TO outbox_current;
    CREATE TABLE outbox(
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    INSERT INTO outbox(id,entity_id,operation,created_at)
      SELECT id,entity_id,operation,created_at FROM outbox_current;
    DROP TABLE outbox_current;
    DROP TABLE sync_conflicts;
    PRAGMA user_version=36;
    COMMIT;
  `);
  assert.equal(schemaVersion(legacy), 36);
  assert.deepEqual(outboxColumns(legacy), [
    "id",
    "entity_id",
    "operation",
    "created_at",
  ]);
  legacy.close();

  const migrated = runStore(legacyPath, openAndInspect);
  assert.deepEqual(migrated.snapshot.classes, seeded.snapshot.classes);
  assert.deepEqual(migrated.snapshot.tasks, seeded.snapshot.tasks);
  assert.deepEqual(
    migrated.snapshot.outbox
      .map(({ id, entityId, operation, createdAt }) => ({
        id,
        entity_id: entityId,
        operation,
        created_at: createdAt,
      }))
      .reverse(),
    originalOutboxRows,
  );
  assert.ok(migrated.batch.length >= 2);
  assert.ok(migrated.batch.every((operation) => operation.payload === "{}"));

  const migratedDatabase = new DatabaseSync(legacyPath);
  assert.equal(schemaVersion(migratedDatabase), 38);
  assert.deepEqual(
    rows(
      migratedDatabase.prepare("SELECT id,name,color FROM classes ORDER BY id"),
    ),
    originalClassRows,
  );
  assert.deepEqual(
    rows(
      migratedDatabase.prepare(
        "SELECT id,class_id,data FROM tasks ORDER BY id",
      ),
    ),
    originalTaskRows,
  );
  assert.ok(outboxColumns(migratedDatabase).includes("payload"));
  assert.ok(
    migratedDatabase
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='sync_conflicts'",
      )
      .get(),
  );

  const preservedPayload = JSON.stringify({
    entity: "task",
    title: "Legacy rotational dynamics set",
    revision: 4,
  });
  const preservedOperationId = migrated.batch[0].id;
  migratedDatabase
    .prepare("UPDATE outbox SET payload=? WHERE id=?")
    .run(preservedPayload, preservedOperationId);
  migratedDatabase.exec("PRAGMA user_version=37;");
  migratedDatabase.close();

  const resumedMigration = runStore(legacyPath, openAndInspect);
  assert.equal(
    resumedMigration.batch.find(
      (operation) => operation.id === preservedOperationId,
    ).payload,
    preservedPayload,
  );
  const resumedDatabase = new DatabaseSync(legacyPath);
  assert.equal(schemaVersion(resumedDatabase), 38);
  assert.equal(
    resumedDatabase
      .prepare("SELECT payload FROM outbox WHERE id=?")
      .get(preservedOperationId).payload,
    preservedPayload,
  );
  resumedDatabase.close();

  for (const fixture of [
    {
      name: "future",
      version: 99,
      message: "This data requires a newer Desk version.",
    },
    {
      name: "corrupt",
      version: 37,
      message: "no such table: outbox",
    },
  ]) {
    const path = join(directory, `${fixture.name}.sqlite`);
    const database = new DatabaseSync(path);
    database.exec(`
      CREATE TABLE sentinel(id TEXT PRIMARY KEY,value TEXT NOT NULL);
      INSERT INTO sentinel VALUES('proof','keep this local data');
      PRAGMA user_version=${fixture.version};
    `);
    const beforeSchema = rows(
      database.prepare(
        "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
      ),
    );
    const beforeSentinel = rows(
      database.prepare("SELECT id,value FROM sentinel ORDER BY id"),
    );
    database.close();

    const rejected = runStore(
      path,
      `
        import { DeskStore } from "./packages/domain/store.ts";
        try {
          new DeskStore(process.env.DESK_FIXTURE_PATH);
          console.log(JSON.stringify({ opened: true }));
        } catch (error) {
          console.log(JSON.stringify({ opened: false, message: error.message }));
        }
      `,
    );
    assert.equal(rejected.opened, false);
    assert.match(rejected.message, new RegExp(fixture.message));

    const after = new DatabaseSync(path);
    assert.equal(schemaVersion(after), fixture.version);
    assert.deepEqual(
      rows(
        after.prepare(
          "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
        ),
      ),
      beforeSchema,
    );
    assert.deepEqual(
      rows(after.prepare("SELECT id,value FROM sentinel ORDER BY id")),
      beforeSentinel,
    );
    assert.equal(
      after
        .prepare(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='classes'",
        )
        .get().count,
      0,
    );
    after.close();
  }

  console.log(
    JSON.stringify(
      {
        result: "PASS",
        flows: [
          "schema-36 class, task and outbox rows migrate through the real DeskStore to schema 38",
          "legacy JSON data stays byte-for-byte stable and new outbox fields receive safe defaults",
          "an existing schema-37 outbox payload survives resumed schema-38 migration exactly",
          "future and structurally corrupt schemas are rejected without replacing their schema, version or sentinel data",
        ],
        limitations: [
          "does not terminate a live process mid-transaction or simulate power loss and WAL recovery",
          "runs on the current macOS host and does not prove Windows SQLite or packaged-app behavior",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
