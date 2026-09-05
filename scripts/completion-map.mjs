import { readFileSync, writeFileSync } from "node:fs";
const map = JSON.parse(readFileSync("Verification/V1Completion.json", "utf8"));
const cell = (value) =>
  String(value ?? "—")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
const rows = (items) =>
  items
    .map(
      (r) =>
        `| ${r.id} | ${cell(r.title)} | ${r.status} / ${r.verification} | ${cell(r.implementation)} | ${cell(r.automated)} | ${cell(r.live)} | ${cell(r.mac)} | ${cell(r.windows)} | ${cell(r.blocker)} |`,
    )
    .join("\n");
const header =
  "| ID | Requirement | Status | Implementation | Automated | Live | macOS | Windows | Remaining |\n|---|---|---|---|---|---|---|---|---|\n";
writeFileSync(
  "Verification/V1Completion.md",
  `# The Desk V1 completion map\n\nGenerated from V1Completion.json. Full Electron/React/TypeScript rebuild; legacy implementation exists only in Git history. Partial evidence never implies a whole requirement or release gate passed.\n\n## Requirements\n\n${header}${rows(map.requirements)}\n\n## Release gates\n\n${header}${rows(map.releaseGates)}\n\nDeferred non-V1 scope and exact acceptance criteria remain in V1Completion.json and the product contract.\n`,
);
