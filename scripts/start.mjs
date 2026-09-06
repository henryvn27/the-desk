import electron from "electron";
import { spawn } from "node:child_process";
// Only the development launcher enables local key loading; packaged apps ignore it.
const child = spawn(electron, ["."], {
  stdio: "inherit",
  env: { ...process.env, DESK_ENABLE_DEVELOPMENT_KEY: "1" },
});
child.on("error", () => { process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
