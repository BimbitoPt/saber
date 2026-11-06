# Visual Web Agent Harness for Saber

## Status and authorization

Status: implemented on `feat/visual-agent-harness`.
Date: 2026-11-06.
Authorization: user requested the visual AI-agent harness to be usable directly with Saber.

## Problem and user workflow

Saber orchestrates coding agents, but frontend quality is still too dependent on model taste and unverified claims. Users need a repeatable visual workflow that guides an agent from brief to design contract, implementation, browser inspection, critique, repair, and evidence-backed completion.

## Scope and exclusions

In scope:
- A reusable project-local `visual-web` skill.
- A detailed visual harness guide and task template.
- Saber-level AGENTS.md routing so frontend tasks discover the skill.
- A deterministic verification script and package command.

Out of scope:
- Migrating Saber from Vite/TanStack Start to Next.js.
- Adding a second standalone application inside Saber.
- Automatically changing model/provider selection.
- Claiming screenshot/console evidence without executing browser checks.
- Installing a new UI or 3D dependency into Saber itself.

## Requirements and acceptance criteria

- VIS-HARNESS-01: Visual web tasks are routed to a dedicated skill from root AGENTS.md.
- VIS-HARNESS-02: The skill defines a mandatory brief/design/build/render/critique/repair/verify workflow.
- VIS-HARNESS-03: The guide contains a scored visual rubric, browser viewport protocol, and Three.js/R3F performance and accessibility gates.
- VIS-HARNESS-04: The task template captures the design contract and evidence.
- VIS-HARNESS-05: `bun run verify:visual-harness` checks required files and core sections.
- VIS-HARNESS-06: Existing Saber stack remains unchanged; Next.js 16/Tailwind 4 guidance applies to target projects that explicitly request it.

## Data and lifecycle

The harness is repository documentation and a project-local agent skill. It has no runtime state, database migration, network access, or provider permissions. Each visual task creates its own design contract and completion receipt in the target project/task artifacts.

## Verification plan

- `bun run verify:visual-harness`: required harness files and sections.
- `bun run verify:harness`: existing Saber harness integrity.
- Review changed files to ensure no generated route files or runtime architecture were altered.
- Browser QA is performed by the consuming agent for each website task; this documentation-only PR does not claim a visual website was built or browser-tested.

## Completion evidence

Implementation files: `docs/harness/visual-web-agent.md`, `docs/harness/visual-web-task-template.md`, `.agents/skills/visual-web/SKILL.md`, `scripts/verify-visual-harness.ts`, `AGENTS.md`, `package.json`.
