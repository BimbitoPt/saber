# Feature specification template

Copy this structure into a dated feature document. Replace the instructional text with concrete requirements before implementation.

## Status and authorization

Record draft/approved status, date, and the user decision authorizing scope.

## Problem and user workflow

Describe the observable problem, who encounters it, and the intended before/after behavior.

## Scope and exclusions

Name the bounded deliverable, dependencies, and intentionally deferred behavior.

## Requirements and acceptance criteria

Assign stable IDs such as FEATURE-01. For each requirement, define the trigger, expected outcome, failure behavior, and a repeatable check that proves it works.

## Data and lifecycle

Define ownership, persistence, state transitions, concurrency rules, and restart recovery. Specify what is immutable and what may change.

## Verification plan

Map each requirement ID to appropriate automated checks or browser verification. Record the commands, inputs, and expected outcomes. Avoid implementation-mirroring tests for trivial changes.

## Completion evidence

Record actual outcomes against each requirement, review findings and resolutions, and remaining limitations. Record `interventions: N`, the number of human corrections the slice needed; if that number is not falling over time, harness work has stalled. Agent exit status alone does not establish verified completion.
