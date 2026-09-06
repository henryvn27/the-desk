import { setTimeout as delay } from "node:timers/promises";

/**
 * Close a Playwright Electron app on macOS, where the app intentionally stays
 * alive after its last window closes. The helper only terminates the process
 * that the smoke launched and gives page recordings a chance to finalize.
 */
export async function closeElectron(app) {
  if (!app) return;
  const child = app.process();
  await Promise.race([
    Promise.all(
      app
        .windows()
        .map((page) => page.close({ runBeforeUnload: false }).catch(() => {})),
    ),
    delay(3_000),
  ]);
  if (child && !child.killed) child.kill("SIGKILL");
  await delay(100);
}
