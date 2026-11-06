import visualWebSkill from "../../.agents/skills/visual-web/SKILL.md?raw";
import visualWebGuide from "../../docs/harness/visual-web-agent.md?raw";
import visualWebTaskTemplate from "../../docs/harness/visual-web-task-template.md?raw";

type VisualWebTask = {
  title: string;
  spec: string;
  criteria: string;
};

const visualWebSignal = /\b(?:website|web site|landing page|home ?page|portfolio(?: site)?|marketing site|product site|e-?commerce|online store|storefront|frontend|front-end|web design|three\.?js|react three fiber|3d (?:site|website|web site|experience))\b/i;
const buildSiteSignal = /\b(?:build|create|design|redesign|make)\b[\s\S]{0,80}\b(?:site|website|web site)\b/i;

export function isVisualWebTask(task: VisualWebTask, followup?: string): boolean {
  const prompt = [task.title, task.spec, task.criteria, followup ?? ""].join("\n");
  return visualWebSignal.test(prompt) || buildSiteSignal.test(prompt);
}

export function visualWebContext(task: VisualWebTask, followup?: string): Array<{ name: string; text: string }> {
  if (!isVisualWebTask(task, followup)) return [];

  return [
    {
      name: "visual-web skill",
      text: [
        "The following canonical Saber visual-web skill is injected by the runtime. It applies even when the target workspace does not contain the Saber documentation files.",
        visualWebSkill.trim(),
      ].join("\n\n"),
    },
    { name: "visual-web agent guide", text: visualWebGuide.trim() },
    { name: "visual-web task template", text: visualWebTaskTemplate.trim() },
  ];
}
