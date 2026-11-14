# ADR-003: Chatflow Studio canvas

| Field | Value |
|---|---|
| **Status** | ACCEPTED for T22. Partially implemented: this decision ships with the `@xyflow/react` dependency and the pure model modules (`model/workflow/graph.ts`, `layout.ts`, `edit.ts`). The canvas components follow in T22-T5 to T22-T8. |
| **Module** | `apps/web-ui` (Studio, Chatflow tab) |
| **Related** | Runtime workflow schema and validator (`apps/agent-runtime/src/agent_runtime/sessions/schemas/workflow.py`, `workflow/validator.py`) |

## Context

Chatflow drafts are edited today only through the JSON tab. Admins need a visual graph editor
with move, connect, delete and handle wiring. The runtime validator is the source of truth for
what a workflow may contain, so the editor must never be able to produce a shape the runtime
rejects only at save time.

## Decision

The Chatflow authoring canvas uses [`@xyflow/react`](https://www.npmjs.com/package/@xyflow/react)
for node and edge interaction. The workflow model remains the source of truth: canvas
components will map it to React Flow nodes and edges, and all changes go back through the pure
helpers in `model/workflow/edit.ts`.

These helpers mirror the runtime's limits and graph rules. They keep the top-level workflow and
node fields they do not edit, but build edges from the contract fields only
(`id`, `source`, `source_handle`, `target`). The runtime schema forbids extra fields, so React
Flow state such as `selected` must never reach the draft.

The editor owns its layered layout algorithm. It does not add `dagre` or another graph-layout
dependency. The layout is deterministic: it layers nodes from the workflow's `entry`, and
orders siblings by the handle order the caller supplies from the node-type catalog (falling back
to edge order).

## Rendering boundary

The canvas is browser-only. Components that import `@xyflow/react` MUST be loaded through
`next/dynamic` with `{ ssr: false }`. This keeps DOM measurement and `ResizeObserver` out of the
server render path.

## Consequences

- `@xyflow/react` is a runtime dependency of `apps/web-ui`.
- The graph model and layout remain pure TypeScript modules and do not depend on React Flow.
- Rules for the canvas components still to come in T22:
  - Canvas CSS is imported only by the client-side canvas boundary.
  - Read-only rendering and editing share the same adapter, with a `readOnly` mode that
    disables mutations.
- The runtime validator stays the final check. Client-side checks only report errors earlier.
