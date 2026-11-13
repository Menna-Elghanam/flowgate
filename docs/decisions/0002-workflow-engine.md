# 0002 — Workflow engine: versioned definitions, request and task state machines

- **Status:** Accepted
- **Date:** 2026-11-12

## Context

The engine is the core of Flowgate. It must route each request through the steps an admin
drew, survive two people acting at the same moment, keep running requests safe when an
admin edits a workflow, and satisfy basic audit rules (who decided what, and no
self-approval).

## Decision

### Definitions: immutable, versioned JSON

- A workflow has numbered **versions**. Each version stores the whole design — the request
  form and the graph of nodes and edges — as one JSON document (Postgres `JSONB`).
- A version is either a `draft` (editable, at most one per workflow) or `published`.
  Published versions **never change**; a database trigger rejects updates to them.
- Editing a published workflow creates a new draft (version N+1). Publishing it makes it the
  version used by **new** requests. Each request stores the version it started with.
- The JSON shape is validated with Zod, and the graph is checked before publishing:
  one start, every node reachable, every path ends, no cycles, conditions reference real
  form fields, each condition has a default path.

### Node types

| Node        | Meaning                                                                                                                                                                           | Outgoing edges              |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `start`     | Where every request begins                                                                                                                                                        | exactly 1                   |
| `approval`  | People must decide. Assignee: specific users, a role, or the requester's manager. Mode: `any` (first approval wins) or `all` (everyone must approve). Optional deadline in hours. | exactly 1 (on approve)      |
| `condition` | Picks the next node from form data, e.g. `cost > 1000`                                                                                                                            | ≥ 1 with a rule + 1 default |
| `end`       | Finishes the request as `approved` or `rejected`                                                                                                                                  | none                        |

Condition nodes are evaluated instantly; requests only ever wait at approval nodes.

### Runtime: normal tables

- `requests`: one row per submitted request, with its status, current step and form data.
- `tasks`: one row per person asked to decide at a step. Each time a step is entered, the
  request's `activation` number increases and the new tasks carry it, so old tasks from an
  earlier visit to the same step never count.
- `audit_events`: append-only history; a database trigger rejects updates and deletes.

### Request state machine

```
submit → in_progress
in_progress → approved | rejected | changes_requested | cancelled
changes_requested → in_progress (resubmit) | cancelled (withdraw)
approved, rejected, cancelled: final
```

### Task state machine

```
pending → approved | rejected | sent_back | skipped | escalated
```

`skipped` = no longer needed (another approver in an `any` step won, or the request ended).
`escalated` = the deadline passed and a new task went to the next level.

### Rules

1. **Send back** returns the request to the requester. On resubmit it re-enters **the same
   step** that sent it back, not the start.
2. **One rejection ends the request**, even in an `all` step.
3. In an **`any`** step the first approval wins; the other open tasks become `skipped`.
4. **Separation of duties:** nobody approves their own request. If an assignee is the
   requester, the task goes to the requester's manager instead; with no manager, to the
   organization's admins (excluding the requester). If nobody is left, submission fails.
5. **Versioning:** a request always follows the version it started with.

### Concurrency

Every state change runs in one database transaction that first locks the request row
(`SELECT … FOR UPDATE`). Two approvals on the same request are therefore applied one after
the other; the second sees the result of the first. Side effects (emails, live updates) are
collected during the transaction and run only **after commit**, so nobody is told about a
change that was rolled back.

## Alternatives considered

- **Normalized tables for definitions** (one row per node and edge): easier to query a
  single node, but a design is always loaded whole, and immutability per version is harder
  to guarantee across many rows.
- **Optimistic locking** (a `version` column and retry on conflict): no waiting on locks,
  but every caller needs retry logic; approvals are rare per request, so a short row lock
  is simpler and correct.
- **Loops and sub-workflows:** out of scope for v1; the graph must be acyclic.
- **A ready-made engine (Camunda, Temporal):** see ADR 0001.

## Consequences

- The engine logic that does not touch the database (graph validation, condition
  evaluation, "where do we go next") lives in a pure package shared by the API and the
  builder UI, so the builder shows the same validation errors as the server.
- Requests on old versions keep working forever; old versions can never be deleted while
  requests reference them.
