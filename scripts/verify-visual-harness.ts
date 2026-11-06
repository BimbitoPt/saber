import { existsSync, readFileSync } from "node:fs";

const required = [
  "docs/harness/visual-web-agent.md",
  "docs/harness/visual-web-task-template.md",
  ".agents/skills/visual-web/SKILL.md",
];
let ok = true;
for (const path of required) {
  if (!existsSync(path)) {
    console.error(`MISSING: ${path}`);
    ok = false;
  }
}
if (ok) {
  const guide = readFileSync(required[0], "utf8");
  const skill = readFileSync(required[2], "utf8");
  for (const phrase of ["Visual acceptance rubric", "Browser QA protocol", "Three.js / React Three Fiber quality gates", "Definition of done"]) {
    if (!guide.includes(phrase)) {
      console.error(`Guide missing section: ${phrase}`);
      ok = false;
    }
  }
  for (const phrase of ["Required workflow", "Non-negotiable visual rules", "Model discipline"]) {
    if (!skill.includes(phrase)) {
      console.error(`Skill missing section: ${phrase}`);
      ok = false;
    }
  }
}
if (!ok) process.exit(1);
console.log("visual web harness verification: OK");
