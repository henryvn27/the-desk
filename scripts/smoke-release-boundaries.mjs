import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("..", import.meta.url));
const packagePath = join(repository, "package.json");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function runTypeScript(source) {
  const result = spawnSync(
    process.execPath,
    ["--no-warnings", "--import", "tsx", "--input-type=module", "-e", source],
    { cwd: repository, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim());
}

async function ensureBuildOutput() {
  const required = [
    join(repository, "dist", "index.html"),
    join(repository, "dist-electron", "main.cjs"),
    join(repository, "dist-electron", "preload.cjs"),
  ];
  const built = await Promise.all(required.map((path) => exists(path)));
  if (built.every(Boolean)) return;
  const result = spawnSync(npmCommand, ["run", "build"], {
    cwd: repository,
    stdio: "inherit",
  });
  assert.equal(result.status, 0, "Production build required for package inventory.");
  for (const path of required)
    assert.equal(await exists(path), true, `Missing build output: ${path}`);
}

async function inspectPackagedArchive() {
  const releaseRoot = join(
    repository,
    packageJson.build?.directories?.output ?? "release",
  );
  if (!(await exists(releaseRoot))) return null;
  const archive = (await filesUnder(releaseRoot)).find(
    (path) => basename(path) === "app.asar",
  );
  if (!archive) return null;

  const { extractFile, listPackage } = await import("@electron/asar");
  const entries = listPackage(archive, { isPack: false });
  const required = [
    "/dist/index.html",
    "/dist-electron/main.cjs",
    "/dist-electron/preload.cjs",
    "/package.json",
  ];
  for (const entry of required)
    assert.equal(
      entries.includes(entry),
      true,
      `Packaged archive is missing ${entry}`,
    );

  const archiveViolations = [];
  for (const entry of required) {
    const content = extractFile(archive, entry.slice(1)).toString("utf8");
    for (const [name, pattern] of forbiddenContent)
      if (pattern.test(content)) archiveViolations.push(`${name}: ${entry}`);
  }
  assert.deepEqual(
    archiveViolations,
    [],
    "Packaged archive contains credential material.",
  );
  return { path: relative(repository, archive), entryCount: entries.length };
}

function providerFailureChecks() {
  return runTypeScript(`
    import { askLens } from "./packages/intelligence/lens-provider.ts";

    const key = "synthetic-provider-key";
    const prompt = "private-prompt-material";
    const jsonHeaders = { "content-type": "application/json" };
    const cases = [
      {
        name: "invalid-json",
        expectedCode: "malformed_response",
        expectedStatus: 200,
        response: () => new Response("not-json", { status: 200 }),
      },
      {
        name: "empty-choice",
        expectedCode: "malformed_response",
        expectedStatus: 200,
        response: () =>
          new Response(JSON.stringify({ model: "openai/gpt-5.6-terra", choices: [] }), {
            status: 200,
            headers: jsonHeaders,
          }),
      },
      {
        name: "authentication",
        expectedCode: "authentication",
        expectedStatus: 401,
        response: () =>
          new Response(
            JSON.stringify({ error: { message: key + " " + prompt } }),
            { status: 401, headers: jsonHeaders },
          ),
      },
    ];
    const results = [];
    for (const fixture of cases) {
      let calls = 0;
      let telemetry;
      let caught;
      try {
        await askLens(
          { question: prompt },
          key,
          {
            fetch: async () => {
              calls += 1;
              return fixture.response();
            },
            onTelemetry: (event) => {
              telemetry = event;
            },
          },
        );
      } catch (error) {
        caught = error;
      }
      results.push({
        name: fixture.name,
        expectedCode: fixture.expectedCode,
        expectedStatus: fixture.expectedStatus,
        calls,
        error: caught
          ? { code: caught.code, status: caught.status, message: caught.message }
          : null,
        telemetry,
      });
    }
    console.log(JSON.stringify(results));
  `);
}

await ensureBuildOutput();

assert.equal(packageJson.main, "dist-electron/main.cjs");
assert.deepEqual(packageJson.build?.files, [
  "dist/**",
  "dist-electron/**",
  "package.json",
]);
assert.deepEqual(packageJson.build?.extraResources, [
  { from: "licenses", to: "licenses" },
]);

const outputRoots = ["dist", "dist-electron"];
const outputFiles = (
  await Promise.all(
    outputRoots.map(async (root) =>
      (await filesUnder(join(repository, root))).map((path) =>
        relative(repository, path),
      ),
    ),
  )
).flat();
assert.ok(outputFiles.length > 0, "Build output is empty.");

const forbiddenNames = /(?:^|\/)(?:\.env(?:\..*)?|[^/]+\.(?:key|pem|p12|sqlite|db))$/i;
const forbiddenContent = [
  ["OpenRouter API key", /sk-or-v1-[A-Za-z0-9_-]{20,}/],
  ["Supabase secret key", /sb_secret_[A-Za-z0-9_-]{20,}/],
  [
    "private key",
    /-----BEGIN(?: RSA| EC| OPENSSH)? PRIVATE KEY-----/,
  ],
  [
    "credential assignment",
    /(?:OPENROUTER_API_KEY|SUPABASE_(?:SERVICE_ROLE|PUBLISHABLE)_KEY)\s*=\s*["']?[^$"'`\s]{8,}/,
  ],
];
const violations = [];
for (const relativePath of outputFiles) {
  assert.equal(
    forbiddenNames.test(relativePath),
    false,
    `Credential-shaped file was included in build output: ${relativePath}`,
  );
  const content = (await readFile(join(repository, relativePath))).toString("utf8");
  for (const [name, pattern] of forbiddenContent)
    if (pattern.test(content)) violations.push(`${name}: ${relativePath}`);
}
assert.deepEqual(violations, [], "Build output contains credential material.");

const providerResults = providerFailureChecks();
for (const result of providerResults) {
  assert.equal(result.calls, 1, `${result.name} must make one request.`);
  assert.equal(result.error?.code, result.expectedCode);
  assert.equal(result.error?.status, result.expectedStatus);
  assert.equal(result.telemetry?.success, false);
  assert.equal(result.telemetry?.errorCode, result.expectedCode);
  assert.equal(result.telemetry?.httpStatus, result.expectedStatus);
  assert.equal(result.telemetry?.usage, null);
  assert.equal(result.telemetry?.cost, null);
  assert.doesNotMatch(
    JSON.stringify(result),
    /synthetic-provider-key|private-prompt-material/,
    `${result.name} leaked request material`,
  );
}

const packageArchive = await inspectPackagedArchive();

console.log(
  JSON.stringify(
    {
      result: "PASS",
      flows: [
        "production build inventory contains only the declared renderer, Electron and package metadata roots",
        "generated build output contains no credential-shaped files or embedded provider secrets",
        "malformed provider bodies and authentication failures produce one bounded error with redacted telemetry",
      ],
      buildFileCount: outputFiles.length,
      buildRoots: outputRoots,
      packageArchive,
      providerFailures: providerResults.map(({ name, error }) => ({
        name,
        code: error.code,
        status: error.status,
      })),
      limitations: [
        "offline synthetic provider responses; no OpenRouter account or charged request",
        "build inventory does not prove signed installer or live Windows packaging",
      ],
    },
    null,
    2,
  ),
);
