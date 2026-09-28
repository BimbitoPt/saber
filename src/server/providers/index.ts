import { opencodeProvider } from "./opencode";
import type { AgentProvider } from "./types";
import { codexProvider } from "./codex";
import { claudeProvider } from "./claude";

const registry: Record<string, AgentProvider> = {
  opencode: opencodeProvider(),
  codex: codexProvider(),
  claude: claudeProvider(),
};

export function getProvider(name = "opencode"): AgentProvider {
  const p = registry[name];
  if (!p) throw new Error(`Unknown provider: ${name}`);
  return p;
}

export function registerProvider(p: AgentProvider) {
  registry[p.name] = p;
}
