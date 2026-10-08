import { opencodeProvider } from "./opencode";
import type { AgentProvider } from "./types";
import { codexProvider } from "./codex";
import { claudeProvider } from "./claude";

let registry: Record<string, AgentProvider> | undefined;

function providers(): Record<string, AgentProvider> {
  return registry ??= {
    opencode: opencodeProvider(),
    codex: codexProvider(),
    claude: claudeProvider(),
  };
}

export function getProvider(name = "opencode"): AgentProvider {
  const p = providers()[name];
  if (!p) throw new Error(`Unknown provider: ${name}`);
  return p;
}

export function registerProvider(p: AgentProvider) {
  providers()[p.name] = p;
}
