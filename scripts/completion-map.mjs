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
const closure = map.latestClosure
  ? `## Latest release-closure snapshot\n\n- Recorded: ${map.latestClosure.recordedAt}\n- Branch: ${map.latestClosure.branch}\n- Status: **${map.latestClosure.status}**\n- Source commit before closure edits: ${map.latestClosure.sourceCommitBeforeClosure}\n- SQLite remains authoritative locally; Supabase is bounded account/cloud sync only.\n- ${map.latestClosure.checks["npm run check"]}\n- ${map.latestClosure.checks["npm run package"]}\n- ${map.latestClosure.checks.electronSmokeSuites}\n- Installed app.asar SHA-256: ${map.latestClosure.package.appAsarSha256}\n\nExternal blockers remain explicit: ${map.latestClosure.externalBlockers.join(" ")}\n\n`
  : "";
writeFileSync(
  "Verification/V1Completion.md",
  `# The Desk V1 completion map\n\nGenerated from V1Completion.json. Full Electron/React/TypeScript rebuild; legacy implementation exists only in Git history. Partial evidence never implies a whole requirement or release gate passed.\n\n${closure}## Requirements\n\n${header}${rows(map.requirements)}\n\n## Release gates\n\n${header}${rows(map.releaseGates)}\n\nDeferred non-V1 scope and exact acceptance criteria remain in V1Completion.json and the product contract.\n`,
);
