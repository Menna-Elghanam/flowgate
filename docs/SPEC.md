# Product Spec — Flowgate (v1)

A workflow & approval engine.

- **Status:** Draft
- **Date:** 2026-11-12

## Problem

In many companies, approvals still run on email, chat and spreadsheets: a laptop request,
a purchase, a leave request, a contract review. Requests get lost, nobody knows who is
holding them, approvers forget, and there is no reliable record of who approved what.

## Solution

A web app where an admin **draws the company's approval process as a flowchart** (steps,
conditions, parallel approvals) without writing code. Employees submit requests through a
form, and the engine routes each request to the right people, reminds and escalates when
someone waits too long, shows live status, and keeps a full audit history.

**Example:** Laptop request → manager approves → if cost > $1,000, finance approves too →
IT assigns the device.

## Users and roles

| Role         | Can do                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------ |
| **Admin**    | Manage the organization and users, build forms and workflows, see all requests and reports |
| **Approver** | See their inbox, approve / reject / send back with a comment                               |
| **Employee** | Submit requests, track their status live, see their history                                |

A user can have several roles. Data never crosses organizations.

## v1 features

1. **Accounts and organizations:** sign up, log in, invite users, assign roles.
2. **Form builder:** request forms with field types (text, number, date, dropdown, file),
   required fields and validation.
3. **Workflow builder (visual):** drag-and-drop steps and arrows; step types:
   - approval by a user, a role, or the requester's manager
   - condition (e.g. `cost > 1000`) that picks the next step
   - parallel approvals (all must approve, or any one)
   - end (approved / rejected)
4. **Workflow engine:**
   - each request is a state machine; invalid moves are rejected
   - **versioned workflows:** editing a workflow creates a new version; requests already
     running keep the version they started with
   - approve, reject, or send back for changes, with a comment
5. **Deadlines and escalation:** each approval step can have a deadline; reminders before
   it, escalation to the next level after it (background jobs).
6. **Inbox and tracking:** approver inbox; "my requests" for employees; live status
   updates without refreshing (WebSockets); email notifications.
7. **Audit log:** append-only history of every action (who, what, when, from which state
   to which), visible per request and exportable.
8. **Dashboard:** requests per workflow, average approval time, slowest steps (bottlenecks).

## Technical challenges (the interview stories)

- **Concurrency:** two approvers act on the same request at the same moment, or both
  parallel approvals finish together → exactly one correct transition, proven by a test.
- **Versioning:** running requests are never broken by workflow edits.
- **Workflow validation:** reject broken diagrams before publishing (no dead ends,
  no unreachable steps, every condition has a default path).
- **Reliable timers:** escalations fire once, survive restarts, and are cancelled when the
  step is completed.
- **Permissions:** enforced in the database query (by organization and role), not only in the UI.

## Quality goals

- Engine logic covered by unit tests; key user flows covered by acceptance tests (ATDD style)
  in Playwright, all running in CI.
- Concurrency test: N simultaneous approvals on one step → exactly one transition.
- Zero data from other organizations in any response (tested).

## Stretch goal (after v1)

- **AI workflow draft:** the admin describes a process in plain words; an LLM drafts the
  workflow, which the admin reviews and edits in the builder before publishing.

## Out of scope for v1

- Integrations (Slack, email inbox parsing, SSO), mobile app, billing.
- Loops and sub-workflows inside a workflow; scripting or custom code steps.

## Decided

- **ORM:** Drizzle (row locking with `SELECT ... FOR UPDATE`), see ADR 0001.
- **Monorepo:** pnpm workspaces, no Turborepo for now, see ADR 0001.
- **Workflow storage:** each published version is an immutable JSON document (JSONB),
  validated with Zod; running requests live in normal tables. Details in ADR 0002.

## Open questions

- Hosting (decide in Phase 7).
