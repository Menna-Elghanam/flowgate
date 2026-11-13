# 0003 — Workflow builder: the definition JSON is the only state

- **Status:** Accepted
- **Date:** 2026-11-13

## Context

The visual builder uses React Flow. React Flow's usual setup keeps its own `nodes` and
`edges` arrays in state (`useNodesState`). Flowgate already has a format for the same
graph, the `WorkflowDefinition` JSON that the API validates and stores (ADR 0002). Keeping
two copies means converting both ways and risks the canvas showing something different
from what gets saved.

## Decision

- The builder keeps **one piece of state: the `WorkflowDefinition`**. React Flow nodes and
  edges are derived from it on every render (`useMemo`).
- React Flow only reports _changes_ (drag, select, delete, measured size). The builder
  turns each into a pure edit function (`lib/builder.ts`: `mapNode`, `connect`,
  `removeNode`, …) and applies it with a functional state update, so several changes in
  the same event (e.g. deleting a node and its edges) never overwrite each other.
- Node sizes measured by React Flow are kept in a small separate map. They are needed to
  draw edges, but they are not part of the design.
- Validation runs live with the same `validateDefinition` the API runs before publishing.
  Only checks that need the database (are these users still members?) come from the server.
- "Unsaved changes" is a JSON comparison of the current definition with the last saved one.

## Alternatives considered

- **React Flow state as the source, convert on save:** what the React Flow docs show.
  Less code at first, but the conversion has to be exact both ways, and live validation
  would have to convert on every change anyway.
- **A state library (Zustand, Redux):** useful if many distant components edited the
  graph. Here the canvas, inspector and form editor all sit under one page component, so
  `useState` plus pure functions is enough.

## Consequences

- The edit functions are plain TypeScript and easy to test or explain on their own.
- Handling React Flow's change events by hand is a little more code (`components/builder/canvas.tsx`).
- Re-deriving nodes on each drag step is fine at our limit of 100 nodes.
