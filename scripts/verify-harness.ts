import { existsSync, readFileSync } from "node:fs";

const root = process.cwd();
const required = [
  "AGENTS.md",
  "docs/harness/diagnostics.md",
  "docs/superpowers/specs/TEMPLATE.md",
  "package.json",
];
let ok = true;
for (const f of required) {
  if (!existsSync(`${root}/${f}`)) {
    console.error(`MISSING: ${f}`);
    ok = false;
  }
}

const agents = readFileSync(`${root}/AGENTS.md`, "utf8");
const rules = ["task/run separation", "Verification gates are read-only to workers", "Never edit `src/routeTree.gen"];
for (const r of rules) {
  if (!agents.includes(r)) {
    console.error(`AGENTS.md missing rule: ${r}`);
    ok = false;
  }
}

const diag = readFileSync(`${root}/docs/harness/diagnostics.md`, "utf8");
if (!diag.includes("Gate integrity")) {
  console.error("diagnostics.md missing Gate integrity section");
  ok = false;
}

if (!ok) process.exit(1);
console.log("harness verification: OK");
