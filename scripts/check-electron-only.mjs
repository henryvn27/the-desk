import { execFileSync } from "node:child_process";

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const forbidden = files.filter((file) =>
  /(?:\.swift$|Swift|\.xcodeproj(?:\/|$)|\.xcworkspace(?:\/|$))/.test(file),
);
if (forbidden.length > 0) {
  console.error("Forbidden native implementation files found:");
  for (const file of forbidden) console.error(`- ${file}`);
  process.exit(1);
}
console.log("PASS: tracked V1 implementation surface contains no Swift/Xcode files.");
