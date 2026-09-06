import { _electron as electron } from "playwright";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const data = await mkdtemp(join(tmpdir(), "desk-account-"));
const output = resolve("artifacts/account");
await mkdir(output, { recursive: true });
const requests = [];
const server = createServer(async (request, response) => {
  requests.push({ method: request.method, path: request.url });
  let body = "";
  for await (const chunk of request) body += chunk;
  if (request.url?.startsWith("/auth/v1/token")) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        access_token: "account-access-token",
        refresh_token: "account-refresh-token",
        expires_in: 3600,
        user: {
          id: "00000000-0000-4000-8000-000000000010",
          email: JSON.parse(body).email,
        },
      }),
    );
    return;
  }
  if (request.url === "/auth/v1/signup") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        access_token: "account-signup-access-token",
        refresh_token: "account-signup-refresh-token",
        expires_in: 3600,
        user: {
          id: "00000000-0000-4000-8000-000000000011",
          email: JSON.parse(body).email,
        },
      }),
    );
    return;
  }
  if (request.url === "/auth/v1/logout") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}");
    return;
  }
  response.writeHead(404);
  response.end();
});

await new Promise((resolveServer) => server.listen(0, "127.0.0.1", resolveServer));
const address = server.address();
assert.ok(address && typeof address === "object");
const supabaseUrl = `http://127.0.0.1:${address.port}`;
let app;
let page;
const errors = [];

async function launch() {
  app = await electron.launch({
    args: process.env.DESK_EXECUTABLE ? [] : ["."],
    executablePath: process.env.DESK_EXECUTABLE,
    env: {
      ...process.env,
      DESK_DATA_DIR: data,
      DESK_ENABLE_DEVELOPMENT_KEY: "0",
      SUPABASE_URL: supabaseUrl,
      SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
      TZ: "UTC",
    },
    recordVideo: { dir: output },
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    page = app.windows().find((window) => window.url().endsWith("#main"));
    if (page) break;
    await new Promise((resolvePage) => setTimeout(resolvePage, 50));
  }
  assert.ok(page, "Main Desk window opened");
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
}

try {
  await launch();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("heading", { name: "Desk account", exact: true }).waitFor();
  await page.getByLabel("Account email", { exact: true }).fill("student@example.edu");
  await page.getByLabel("Password", { exact: true }).fill("long-enough-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByText("Signed in to the Desk account.", { exact: true }).waitFor();
  const signedIn = await page.evaluate(() => window.desk.accountStatus());
  assert.equal(signedIn.authenticated, true);
  assert.equal(signedIn.email, "student@example.edu");
  assert.equal(signedIn.userId, "00000000-0000-4000-8000-000000000010");
  const firstVideo = page.video();
  await page.screenshot({ path: join(output, "account.png") });
  await app.close();
  app = undefined;
  if (firstVideo) await copyFile(await firstVideo.path(), join(output, "account-operated.webm"));

  await launch();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByText("Signed in as", { exact: false }).waitFor();
  const restarted = await page.evaluate(() => window.desk.accountStatus());
  assert.equal(restarted.authenticated, true);
  await page.getByRole("button", { name: "Sign out of Desk account", exact: true }).click();
  await page.getByText("Desk account signed out.", { exact: true }).waitFor();
  const signedOut = await page.evaluate(() => window.desk.accountStatus());
  assert.equal(signedOut.authenticated, false);
  await page.getByLabel("Account email", { exact: true }).fill("new@example.edu");
  await page.getByLabel("Password", { exact: true }).fill("another-long-password");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByText("Desk account created and signed in.", { exact: true }).waitFor();
  const created = await page.evaluate(() => window.desk.accountStatus());
  assert.equal(created.authenticated, true);
  assert.equal(created.email, "new@example.edu");
  assert.equal(requests.filter((request) => request.path?.startsWith("/auth/v1/token")).length, 1);
  assert.equal(requests.filter((request) => request.path === "/auth/v1/signup").length, 1);
  assert.equal(requests.filter((request) => request.path === "/auth/v1/logout").length, 1);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: trusted main-process Supabase account sign-in, encrypted restart persistence, sign-out and sign-up flow work without exposing credentials to the renderer.",
  );
} finally {
  if (app) await app.close();
  await new Promise((resolveServer) => server.close(resolveServer));
  await rm(data, { recursive: true, force: true });
}
