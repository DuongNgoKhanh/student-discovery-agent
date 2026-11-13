# ADR-003 — Chatflow Studio canvas

## Status

Accepted for T22.

## Decision

The Chatflow authoring canvas uses [`@xyflow/react`](https://www.npmjs.com/package/@xyflow/react)
for node and edge interaction. The workflow model remains the source of truth; the canvas
adapter maps it to React Flow nodes and edges and preserves unknown workflow fields when
writing changes back to the draft.

The editor owns its layered layout algorithm. It does not add `dagre` or another graph-layout
dependency, so layout behavior stays deterministic and follows the workflow's `entry` and
handle order.

## Rendering boundary

The canvas is browser-only. Components that import `@xyflow/react` must be loaded through
`next/dynamic` with `{ ssr: false }`. This keeps DOM measurement and `ResizeObserver` out of
the server render path and lets jsdom tests mock the small browser APIs required by the canvas.

## Consequences

- `@xyflow/react` is a runtime dependency of `apps/web-ui`.
- Canvas CSS is imported only by the client-side canvas boundary.
- Read-only rendering and editing share the same adapter; `readOnly` disables mutations.
- The graph model and layout remain pure TypeScript modules and do not depend on React Flow.
