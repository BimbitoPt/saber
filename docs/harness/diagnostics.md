# Harness diagnostics — fault the harness before the model

Adapted from Prime Intellect's swarm findings (Oct 2026) and this repo's own pitfalls. When an agent misbehaves, find the symptom in the table, apply the first move, and only consider a model change last.

## Layers

| Layer | In this repo |
|---|---|
| World | dev server (port 8082), browser pane, WSL, Tauri sidecar, git worktrees |
| Harness | AGENTS.md, specs and plans, vitest suite, `scripts/verify-*.ts`, sessions, skills |
| Inference | provider adapter, latency, streaming, token cost |
| Model | reasoning, knowledge |

Most failures land in the harness layer. A strong model in a weak harness produces a mediocre agent; a mediocre model in a strong harness often surprises.

## Symptom table

| Symptom | Likely cause | Layer | First move |
|---|---|---|---|
| Forgets an AGENTS.md rule mid-task | Rule not loaded, buried, or context filled | harness | Restate the rule in the task prompt; if the doc grew long, split it |
| Repeats the same error across attempts | No external check between attempts | harness | Run the spec's check before the next attempt; write the failure down |
| Exits "done" without meeting criteria | No machine-checkable done-criterion | harness | Map exit to requirement IDs; a green build is not evidence |
| Edits tests or verification to go green | Gate is editable by the worker | harness | Reject the diff; check commands come from the spec (see AGENTS.md) |
| Burns tokens with no progress | Loop without budget | harness/inference | Estimate cost before dispatch, cap attempts, stop when nothing improves |
| Loses work or context across sessions | State lives only in the transcript | harness | State goes in spec/plan/handoff files, written after the question is known |
| Works alone, degrades in parallel | Shared mutable state | harness | Task worktrees; serialize shared-checkout tasks |
| Hallucinated APIs, files, or flags | Stale or missing tool/doc context | harness | Refresh docs; point at a real in-repo example to copy |
| Contorts to hit a metric, skips the goal | No uneditable external verifier | harness | Add an external gate; prompt reminders do not stop this (Factorio case) |
| Slow steps, flaky spawns | Provider or infra | inference | Check adapter logs; opencode stdin must be "ignore" (AGENTS.md) |
| Fails a hard reasoning problem it should solve | Capability limit | model | Now consider a model change |

## Pocket rules

- If a model swap improves the outcome less than about 20%, the problem is not the model.
- Investment order: harness, then inference, then more agents. Never invert it.
- A sub-agent's answer is written after the question is known. Delegate heavy reading instead of trusting blind compaction.
- Estimate cost before any parallel dispatch, cap attempts, and stop when tokens burn without progress.

## Escalation: single agent to sub-agents

Use `swarm.level`. Move to sub-agents only when all three hold: genuinely independent parts, objective external verification exists, no shared mutable state.

Stop scaling when any of these appear: coordination traffic grows faster than progress, agents duplicate each other's work, cost per task rises at flat quality, or you cannot explain what each agent did.

## Gate integrity

- The check command comes from the feature spec, not from the worker.
- A diff that touches tests, verification plans, or acceptance criteria needs human review before a green run counts as evidence.
- A gate the agent can edit is not a gate. A prompt reminder is not a gate.
- A recurring check that cannot be a vitest test deserves its own `scripts/verify-*.ts` (pattern: `scripts/verify-terminal.ts`).
