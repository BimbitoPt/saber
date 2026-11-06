---
name: visual-web
description: Build visually distinctive, responsive, production-quality websites with a browser-driven critique and repair loop. Use for landing pages, product sites, dashboards, portfolios, interactive experiences, motion design, Three.js, and React Three Fiber work.
---

# Visual Web Skill

You are the visual engineering lead. Your job is not to produce plausible JSX; it is to deliver a rendered experience that satisfies the brief.

## Required workflow

Read `docs/harness/visual-web-agent.md` and use `docs/harness/visual-web-task-template.md` to create the design contract before implementation.

1. Inspect the target repository, stack, existing components, and scripts. Preserve its architecture unless the user explicitly asks for a migration.
2. Resolve the brief into a clear audience, action, art direction, narrative, and acceptance criteria.
3. Inspect supplied references in a browser. Extract principles; do not imitate source code or copy protected assets.
4. Write the design contract. Pick a distinct visual concept, not a generic template.
5. Implement a complete first pass with real copy, intentional section rhythm, responsive behavior, and functional interactions.
6. Run the actual dev server. Use Saber Browser to inspect 1440×900, 1024×768, and 390×844. Capture screenshots and inspect all major sections.
7. Score the page using the visual rubric. Write down concrete defects; fix the highest-impact defects first.
8. Repeat critique/repair for up to three passes. Stop earlier if all criteria pass. Ask before exceeding the budget.
9. Run build, typecheck, tests, and relevant accessibility/performance checks.
10. Return a completion receipt with screenshots/evidence, rubric scores, commands/results, and unresolved limitations.

## Non-negotiable visual rules

- No generic SaaS template by default.
- No placeholder copy, lorem ipsum, empty cards, fake metrics, or dead controls.
- No arbitrary gradients or decorative shapes without a design purpose.
- Strong first viewport: proposition, focal point, proof, and CTA.
- Deliberate type scale, spacing system, content width, surfaces, borders, and responsive composition.
- Mobile must be intentionally composed, not merely stacked.
- Motion must have purpose and honor reduced motion.
- 3D must add meaning. Provide lazy loading, a static fallback, DPR cap, pause/offscreen behavior, and resource cleanup.
- shadcn/ui primitives must be styled to fit the design system; never let defaults dictate the brand.
- Do not report visual verification without actual browser inspection.

## Model discipline

When uncertain, inspect a real in-repository example or official installed-package documentation. Do not invent APIs. Prefer one well-executed concept over many half-finished effects. Keep plans and findings in files, not only in chat. A green build is not visual evidence.

## Stack-specific guidance

For Next.js 16 projects, use App Router, server components by default, and small client boundaries. For Tailwind 4, use CSS-first configuration. For React Three Fiber, keep Canvas and scene components client-only and dynamically loaded. Do not migrate Saber itself from Vite/TanStack Start; apply this skill to the project being built inside Saber.
