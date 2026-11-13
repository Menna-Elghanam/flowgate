# Progress Log — Flowgate

Claude: read this at the start of each session, and update it at the end.

## Current status

- **Phase:** v1 built end to end, not committed yet. Phases 1–6 are done; Phase 7 (deploy, demo GIF) is open.
- **Verified 2026-11-13:** 30 engine unit tests, 65 API tests (real Postgres), 4 Playwright
  acceptance flows, lint, typecheck, format check, production build.
- **Next:** first commits + PR, push so CI runs, decide hosting, deploy, record demo GIF.

## Open items (carried between sessions)

- Decide: hosting. Needs long-running processes: API (+ WebSockets), worker, Postgres, Redis.
- Rename the local project folder from `knowledge-assistant` to `flowgate` (user will do it).
- CI workflow is written but has never run on GitHub: check the first run.
- Sample workflow "contract review" (from the original list) is not in the seed; laptop,
  purchase and leave are.

## Roadmap

### Phase 1 — Planning

- [x] Product spec, ADR 0001 (stack), ADR 0002 (engine)
- [x] Sample workflows (in the seed: laptop, purchase, leave)
- [ ] Sketch main screens (skipped: built directly)

### Phase 2 — Foundations

- [x] Monorepo (pnpm), ESLint + Prettier, TypeScript strict, Jest
- [x] Docker compose: Postgres, Redis, Mailpit
- [x] NestJS skeleton: config validation, logging, error filter, health check
- [x] Migrations; users, organizations, memberships
- [x] GitHub Actions CI (written, not yet run on GitHub)
- [x] Auth + organizations + roles + invites

### Phase 3 — Forms and workflows

- [x] Form builder (API + UI)
- [x] Workflow definitions: storage, versioning, validation before publish
- [x] Visual workflow builder with React Flow (ADR 0003)

### Phase 4 — Engine

- [x] Submit; state machine; approve / reject / send back / resubmit / withdraw
- [x] Conditions and parallel approvals
- [x] Concurrency safety + tests with simultaneous approvals
- [x] Audit log (append-only, trigger-enforced)

### Phase 5 — Inbox, real-time, timers

- [x] Approver inbox, "my requests"
- [x] WebSocket live status
- [x] Deadlines, reminders, escalation (BullMQ); email notifications

### Phase 6 — Polish

- [x] Dashboard (approval times, bottlenecks)
- [x] Permission tests across organizations
- [x] Acceptance tests (Playwright), rate limiting
- [ ] Security review (run `/security-review` before deploying)

### Phase 7 — Case study

- [ ] Deploy + demo account with sample workflows
- [x] README: architecture diagram, engine design, setup steps
- [ ] README: live demo link, demo GIF
- [x] ADRs 0001–0003
- [ ] (Stretch) AI workflow draft from plain-language description

## Session log

<!-- Newest first. Template:
### YYYY-MM-DD
**Did:**
**Decisions:**
**📌 Interview notes:**
**Next:**
**Open questions:**
-->

### 2026-11-13 (session 3)

**Did:**

- Found PROGRESS.md out of date: session 2 had built the API, engine, jobs, realtime and
  the web app's auth pages, but not logged them. This entry covers both sessions.
- Built every in-app page: inbox, my/all requests, new request, request detail (decide,
  resubmit, withdraw, steps, history), members + invites, dashboard, audit log + CSV export,
  workflow list, and the visual builder (canvas, inspector, form editor, live problems,
  save draft / publish / discard, versions).
- Playwright: config, a login setup step that saves sessions, 4 acceptance flows.
- GitHub Actions CI (checks job + e2e job), README, ADR 0003. Formatted the whole repo.

**Decisions:**

- Builder state = the definition JSON only; React Flow nodes/edges derived from it (ADR 0003).
- Builder remounts only when a new version goes live, so background refetches never wipe edits.
- Playwright reuses saved sessions (`storageState`) instead of logging in per test.

**Bugs found and fixed:**

- App shell said "you're not a member" for _any_ error, even "server unreachable"
  (seen when the API was restarting). Now only 403/404 say that; others show the real message + retry.
- Moving choice-list fields in the form editor could show the wrong options text.
- E2E runs back to back hit the login rate limit (10/min): fixed with saved sessions;
  CI also raises the limit for its test job.

**📌 Interview notes:**

- Single source of truth for the builder (ADR 0003): no second graph to keep in sync, and the
  builder validates with the exact function the server uses before publishing.
- The live-update test proves the WebSocket path: the requester's page turns "Approved"
  without a reload after the manager decides in another browser.
- Rate limiting showed up in our own tests: a good story about security controls vs testability.

**Next:**

1. Review the code, then commit in small steps (suggested order in the session summary) and open a PR.
2. Push; check the first CI run.
3. Decide hosting; deploy; record the demo GIF; add the link to the README.
4. Run a security review before deploying.

**Open questions:** hosting choice; add the "contract review" sample workflow or not.

### 2026-11-12 (session 2, logged afterwards)

**Did:** wrote ADR 0002, set up the monorepo and tooling, built the API (auth, orgs,
invites, workflows, requests, engine, audit, dashboard, health), the background worker
(emails, deadline sweep), WebSocket gateway, demo seed, and the web app's auth pages.

### 2026-11-12 (session 1)

**Did:**

- Reviewed the CV: Slotwise is strong; the Restaurant POS project repeats it and should be replaced.
- Compared several ideas (RAG knowledge assistant, support QA, data analyst, ticket triage).
- Chose a **workflow & approval engine** instead: close to existing experience, adds new
  depth (state machines, versioning, timers, real-time), fits enterprise/consulting roles.
- Deleted the old knowledge-assistant docs; wrote the new `CLAUDE.md`, `docs/SPEC.md`, ADR 0001.

**Decisions:**

- Stay in TypeScript; use NestJS (not Express) to avoid repeating Slotwise.
- Build the engine ourselves, no Camunda/Temporal, because the engine is the point.
- Product name: **Flowgate** (requests flow through steps and stop at approval gates).
- ORM: **Drizzle** (built-in row locking for concurrent approvals), not Prisma.
- Monorepo: **pnpm workspaces** only; Turborepo later if needed.
- Workflow storage: **immutable versioned JSON (JSONB) for definitions, tables for runtime state**.
- ADR 0001 accepted.

**📌 Interview notes:**

- Chose Drizzle over the familiar Prisma because the engine's key operation (locking a request
  row during an approval) is built into Drizzle but needs raw SQL in Prisma.
- Definitions vs runtime split: designs are read whole and never change once published (JSON);
  runtime data is searched and filtered (tables with indexes).
- AI is a stretch goal, not the core.

**Next:**

1. Review the spec; answer the open questions.
2. Accept ADR 0001.
3. Design the engine (states, transitions, versioning) before writing code.

**Open questions:** see "Open items" above.
