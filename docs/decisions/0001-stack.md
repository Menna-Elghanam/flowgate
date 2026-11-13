# 0001 — Stack: NestJS + PostgreSQL backend, Next.js + React Flow frontend

- **Status:** Accepted
- **Date:** 2026-11-12

## Context

This is the second portfolio project, next to Slotwise (Next.js, Express, Prisma, BullMQ).
It should show enterprise-style engineering (business processes, state machines,
versioning, audit, concurrency) and add skills Slotwise doesn't show, while staying in
TypeScript so the time goes into the engine design, not a new language.

## Decision

- **API:** NestJS. Modules, dependency injection and guards suit a larger enterprise-style
  codebase, and it shows a second Node framework next to Express from Slotwise.
- **Database:** PostgreSQL. Transactions and row locks handle concurrent approvals; JSONB
  can store workflow definitions and form answers.
- **ORM:** Drizzle. The engine needs row locks (`SELECT ... FOR UPDATE`) when two
  approvers act at once; Drizzle supports them in its query builder, and its SQL-like
  queries keep the locking visible.
- **Validation:** Zod for workflow definitions and form schemas.
- **Monorepo:** pnpm workspaces (`apps/api`, `apps/web`). No Turborepo until build times
  make it worth it.
- **Background jobs:** Redis + BullMQ for deadlines, reminders, escalations and emails.
- **Real-time:** WebSockets through a NestJS gateway for live request status.
- **Frontend:** Next.js + TypeScript + Tailwind, TanStack Query, React Flow for the
  visual workflow builder.
- **Testing:** Jest for unit and API tests, Playwright for acceptance tests, GitHub Actions CI.

## Alternatives considered

- **Express (as in Slotwise):** known and simple, but repeats Slotwise and leaves more
  structure to invent by hand.
- **Prisma (as in Slotwise):** known and well-tooled, but has no built-in row locking, so
  the most important engine queries would be raw SQL.
- **TypeORM:** the classic NestJS pairing, but weaker type safety than Drizzle.
- **Turborepo:** build caching across apps; not needed with two apps.
- **A ready-made workflow engine (Camunda, Temporal):** powerful, but hides the engine,
  which is the part this project exists to build and explain.
- **Python (FastAPI):** would add a language to the CV, but splits focus between a new
  language and a hard design problem.

## Consequences

- NestJS and Drizzle are new; both have concepts to learn (modules, providers,
  decorators; Drizzle schema and migrations).
- Engine correctness depends on careful transactions and locking; to be proven by tests.
- Hosting needs long-running processes for the API, workers and WebSockets.
