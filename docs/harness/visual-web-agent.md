# Visual Web Agent Harness

Status: approved implementation baseline
Audience: Saber coding agents working on frontend, marketing, product, and 3D web experiences
Primary goal: make visual quality an engineered outcome rather than a prompt-dependent accident.

## Operating model

The harness is a closed loop:

1. **Brief** — extract audience, goal, content, brand constraints, routes, interactions, target devices, and performance budget.
2. **Reference** — inspect the target site and supplied references. Identify composition, type scale, density, motion language, color, and interaction patterns. Do not copy assets or source.
3. **Design contract** — write a compact page plan before coding: section order, visual hierarchy, responsive behavior, interaction states, motion, 3D role, and acceptance criteria.
4. **Build** — implement the smallest coherent vertical slice. Prefer existing project conventions. Do not replace a working stack to satisfy a fashionable stack request.
5. **Render** — start the real dev server and use Saber Browser to inspect desktop and mobile viewports. A successful compile is not visual verification.
6. **Critique** — score the rendered page against the rubric below. Record concrete defects with viewport, selector/region, severity, and evidence.
7. **Repair** — fix the highest-impact defect first. Re-render after each meaningful batch. Maximum three critique/repair passes unless the user authorizes more.
8. **Verify** — run project checks, inspect console/network failures where available, test interactions and responsive states, and report evidence plus remaining limitations.

## Rules that compensate for weaker models

- Never start with generic navbar + centered hero + three cards unless the brief genuinely calls for it.
- Make one strong art-direction decision and carry it through every section.
- Use real content with deliberate line lengths. Avoid filler copy, repeated cards, arbitrary gradients, and random decorative blobs.
- Establish a spacing scale, type scale, surface system, border treatment, and motion language before building components.
- Every section must have a job. Remove sections that do not advance the narrative or conversion.
- Use asymmetry, scale, depth, overlap, cropping, and negative space intentionally. Avoid accidental sameness.
- Make the first viewport unmistakable: clear proposition, focal point, visual proof, and a useful next action.
- Design mobile as a composition, not a desktop layout squeezed smaller.
- Motion must communicate hierarchy or state. Respect reduced-motion preferences and provide a static fallback.
- 3D must earn its cost. Use it as a focal point or meaningful interaction, not as a random background.
- Do not claim a page is finished because the model says it is. Browser evidence and acceptance checks decide.

## Design contract

Before implementation, write these fields in the task spec or plan:

- Audience and primary action
- Brand personality in 3–5 adjectives
- Reference observations (not copied implementation)
- Page narrative and section sequence
- Hero composition and focal point
- Type families/scale and content width
- Color tokens and surface rules
- Interaction inventory and states
- Motion rules, reduced-motion behavior
- 3D scene purpose, camera, lighting, material, controls, fallback
- Desktop, tablet, and mobile layout changes
- Performance and accessibility budgets
- Acceptance criteria with stable IDs

## Visual acceptance rubric

Score each dimension 0–4. A page cannot be called visually verified if any dimension is below 3.

| Dimension | 0 | 2 | 4 |
|---|---|---|---|
| Art direction | no coherent intent | recognizable but generic | distinctive and consistent |
| Hierarchy | unclear | mostly readable | immediate, deliberate scan path |
| Typography | defaults/mismatches | adequate scale | expressive, controlled, readable |
| Composition | repetitive blocks | some variation | intentional depth, rhythm, whitespace |
| Color/surfaces | arbitrary | consistent basics | cohesive, nuanced system |
| Interaction | broken/static | primary action works | clear states and polished feedback |
| Responsive | overflow/broken | usable | composition rethought per viewport |
| Motion/3D | distracting/broken | functional | purposeful, performant, accessible |
| Accessibility | major blockers | basic semantics | keyboard, contrast, labels, reduced motion |
| Performance | severe jank | acceptable | optimized loading and graceful fallback |

Minimum: 30/40 overall, with no dimension below 3. A low score means repair, not rationalization. Record scores and evidence; do not fabricate a score when browser inspection was unavailable.

## Browser QA protocol

Use the browser already exposed by Saber. Navigate to the local dev URL and inspect at:

- 1440 × 900 desktop
- 1024 × 768 compact desktop/tablet
- 390 × 844 mobile

At each size:
- capture a screenshot after fonts and primary media settle;
- inspect the first viewport and every major section;
- check horizontal overflow and clipped content;
- exercise navigation, menus, forms, toggles, and primary CTA;
- inspect loading, empty, error, and reduced-motion states where relevant;
- verify focus visibility and keyboard reachability.

For long pages, capture full-page evidence plus focused screenshots of hero, interaction, and mobile composition. If browser controls do not expose viewport resizing or console inspection, state that limitation instead of implying it was tested.

## Three.js / React Three Fiber quality gates

- Keep scene code isolated from server components; use client boundaries deliberately.
- Prefer React Three Fiber and Drei where they simplify lifecycle and interaction; avoid unnecessary abstractions.
- Lazy-load the canvas and show a designed poster/fallback until it is ready.
- Use demand rendering for mostly static scenes; pause when offscreen or document-hidden.
- Cap device pixel ratio (normally 1–1.5 on mobile) and avoid excessive lights, shadows, transparent layers, and draw calls.
- Reuse geometries/materials, dispose of resources, and avoid creating new objects on every frame.
- Use instancing for repeated meshes. Avoid expensive post-processing by default.
- Respect reduced motion; disable auto-rotation and provide a non-WebGL fallback.
- Make controls discoverable and keyboard accessible where interaction is part of the experience.
- Test on a low-power/mobile profile when available. If not available, disclose it.

## Next.js 16 + Tailwind 4 + shadcn/ui baseline

When the target project explicitly calls for this stack:
- use Next.js App Router and current Next.js 16 conventions;
- use Tailwind CSS 4 CSS-first configuration, not legacy v3 config assumptions;
- use shadcn/ui as accessible primitives, not as the visual identity;
- use server components by default and client components only for state, browser APIs, animation, or WebGL;
- isolate R3F scenes behind dynamic client-only loading;
- keep dependencies current and verify exact installed APIs instead of guessing;
- avoid importing the entire component library or shipping unused icon/animation packages.

Saber itself remains on its existing Vite + TanStack Start stack. This harness is a reusable workflow and project skill; it does not migrate Saber to Next.js.

## Definition of done

- All functional acceptance criteria pass.
- Browser evidence exists at desktop and mobile sizes, plus a tablet check.
- Visual rubric is at least 30/40 and every dimension is at least 3, or unverified dimensions are explicitly disclosed.
- No known severe console/runtime errors, broken routes, or horizontal overflow.
- Reduced-motion and non-WebGL fallbacks exist for motion/3D experiences.
- Build, lint/typecheck, and relevant tests pass.
- Final handoff lists what changed, commands run, evidence, scores, and unresolved risks.
