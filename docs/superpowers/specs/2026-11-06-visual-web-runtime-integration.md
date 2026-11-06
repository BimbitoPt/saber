# Visual Web Runtime Integration

## Status and authorization

Status: implementation in progress on `feat/visual-web-runtime-integration`.
Date: 2026-11-06.
Authorization: user requested implementation after review and merge of PR #9.

## Problem

PR #9 added the reusable visual-web skill and guidance, but the skill was only routed through Saber repository instructions. Agent runs targeting arbitrary user workspaces did not automatically receive the instructions. A nontechnical user could describe a website, but the runtime did not reliably attach the visual-web workflow.

## Scope

- Detect visual-web work from task title, specification, acceptance criteria, and follow-up text.
- Bundle the canonical skill, guide, and task template into the Saber server build.
- Inject those materials into the assembled agent prompt for matching runs, including arbitrary target workspaces.
- Include the injected materials in context source accounting and prompt-budget checks.
- Keep ordinary backend tasks free of the visual-web context.
- Make browser QA instructions capability-aware; never imply that Saber Browser is callable by an agent unless it is exposed in that session.

## Acceptance criteria

- VIS-RUNTIME-01: A plain-language request such as "Build a premium 3D website for my car company" is detected without a user-selected mode.
- VIS-RUNTIME-02: Matching runs receive the canonical visual-web skill, guide, and task template without requiring those files in the target workspace.
- VIS-RUNTIME-03: A visual-web follow-up is detected even when the original task is generic.
- VIS-RUNTIME-04: Backend-only tasks do not receive the visual-web context.
- VIS-RUNTIME-05: Injected context is included in the existing source list and prompt-budget validation.
- VIS-RUNTIME-06: Browser QA guidance distinguishes available browser tooling from unavailable tooling and forbids unsupported verification claims.

## Verification

- `bun run test -- src/server/visualWeb.test.ts src/server/agentRuns.test.ts`
- `bun run build`
- Typecheck through the repository CI workflow.

## Explicit exclusions

This slice does not add a user-facing visual mode, an automated visual scoring engine, or a new browser-control API for agent subprocesses. It injects the workflow into the existing agent run pipeline and keeps browser-tool availability honest.
