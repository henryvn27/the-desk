import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCaptureTextFiles } from "./text-files";

test("native text import preserves UTF-8 content and only exposes basenames", async () => {
  const dir = await mkdtemp(join(tmpdir(), "desk-text-import-"));
  try {
    await writeFile(join(dir, "lesson.md"), "\ufeffPhysics: résumé and Δv\n");
    await writeFile(join(dir, "work.txt"), "Read chapter 3\n");
    assert.deepEqual(
      await readCaptureTextFiles([
        join(dir, "lesson.md"),
        join(dir, "work.txt"),
      ]),
      [
        { name: "lesson.md", text: "Physics: résumé and Δv\n" },
        { name: "work.txt", text: "Read chapter 3\n" },
      ],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("invalid, oversized, credential-shaped and unsupported imports fail without content or path in errors", async () => {
  const dir = await mkdtemp(join(tmpdir(), "desk-text-invalid-"));
  try {
    await writeFile(join(dir, "valid.txt"), "Read chapter 3");
    for (const [name, content] of [
      ["empty.txt", " "],
      ["large.txt", "x".repeat(80001)],
      ["long.txt", "x".repeat(20001)],
      ["invalid.txt", Buffer.from([0xff, 0xfe])],
      ["binary.md", "a\0b"],
      // Synthetic marker only; no real credential is used by this test.
      ["config.txt", "OPENROUTER_API_KEY=not-a-real-key"],
      ["worksheet.pdf", "%PDF"],
      [".env.local", "synthetic"],
    ] as const) {
      await writeFile(join(dir, name), content);
      await assert.rejects(
        readCaptureTextFiles([join(dir, "valid.txt"), join(dir, name)]),
        (error) => {
          assert.ok(error instanceof Error);
          assert.equal(error.message.includes(dir), false);
          assert.equal(error.message.includes("not-a-real-key"), false);
          return true;
        },
      );
    }
    await assert.rejects(
      readCaptureTextFiles(Array(11).fill(join(dir, "valid.txt"))),
    );
    if (process.platform !== "win32") {
      await symlink(join(dir, "valid.txt"), join(dir, "link.txt"));
      await assert.rejects(readCaptureTextFiles([join(dir, "link.txt")]));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
