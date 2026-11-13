import type {
  Assignee,
  FormField,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from '@flowgate/workflow';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { Clock } from '../src/core/clock';
import { loadConfig } from '../src/core/config';
import { DB, type Db } from '../src/core/db/db.module';
import { EffectsRunner, type Effects, type EmailJob } from '../src/core/effects/effects';
import { EngineService } from '../src/engine/engine.service';

/** Records what would have been emailed or pushed, instead of using Redis and SMTP. */
export class RecordingEffectsRunner extends EffectsRunner {
  batches: Effects[] = [];

  async flush(effects: Effects): Promise<void> {
    this.batches.push(effects);
  }

  get emails(): EmailJob[] {
    return this.batches.flatMap((b) => b.emails);
  }

  emailsTo(userId: string): EmailJob[] {
    return this.emails.filter((e) => e.toUserId === userId);
  }

  reset(): void {
    this.batches = [];
  }
}

export class TestClock extends Clock {
  current = new Date();

  override now(): Date {
    return new Date(this.current);
  }

  advanceHours(hours: number): void {
    this.current = new Date(this.current.getTime() + hours * 3_600_000);
  }
}

export interface TestApp {
  app: INestApplication;
  db: Db;
  engine: EngineService;
  effects: RecordingEffectsRunner;
  clock: TestClock;
  agent: () => TestAgent;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const effects = new RecordingEffectsRunner();
  const clock = new TestClock();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EffectsRunner)
    .useValue(effects)
    .overrideProvider(Clock)
    .useValue(clock)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app, loadConfig());
  await app.init();
  return {
    app,
    db: app.get<Db>(DB),
    engine: app.get(EngineService),
    effects,
    clock,
    agent: () => request.agent(app.getHttpServer()),
    close: () => app.close(),
  };
}

export async function resetDb(db: Db): Promise<void> {
  // TRUNCATE doesn't fire row triggers, so it can clear the append-only audit table.
  await db.execute(sql`TRUNCATE audit_events, tasks, requests, workflow_versions, workflows,
    invites, memberships, sessions, organizations, users RESTART IDENTITY CASCADE`);
}

// ---------------------------------------------------------------- people

export interface Person {
  id: string;
  agent: TestAgent;
}

export interface World {
  orgId: string;
  admin: Person;
}

let counter = 0;
const uniqueEmail = (name: string) =>
  `${name.toLowerCase().replace(/\W/g, '')}.${++counter}@test.dev`;

export async function createOrg(t: TestApp, orgName = 'Acme'): Promise<World> {
  const agent = t.agent();
  const res = await agent
    .post('/auth/signup')
    .send({
      name: 'Ada Admin',
      email: uniqueEmail('admin'),
      password: 'password123',
      organizationName: orgName,
    })
    .expect(201);
  return { orgId: res.body.orgId, admin: { id: res.body.user.id, agent } };
}

/** Adds a member through the real invite flow. */
export async function addMember(
  t: TestApp,
  world: World,
  name: string,
  roles: string[] = ['employee'],
  managerId: string | null = null,
): Promise<Person> {
  const invite = await world.admin.agent
    .post(`/orgs/${world.orgId}/invites`)
    .send({ email: uniqueEmail(name), roles, managerId })
    .expect(201);
  const token = String(invite.body.link).split('/invite/')[1];
  const agent = t.agent();
  const res = await agent
    .post(`/invites/${token}/accept`)
    .send({ name, password: 'password123' })
    .expect(201);
  return { id: res.body.user.id, agent };
}

// ---------------------------------------------------------------- workflows

const at = { x: 0, y: 0 };

export const node = {
  start: (): WorkflowNode => ({ id: 'start', type: 'start', position: at }),
  approval: (
    id: string,
    assignee: Assignee,
    extra: { mode?: 'any' | 'all'; dueInHours?: number | null; name?: string } = {},
  ): WorkflowNode => ({
    id,
    type: 'approval',
    position: at,
    name: extra.name ?? id,
    assignee,
    mode: extra.mode ?? 'any',
    dueInHours: extra.dueInHours ?? null,
  }),
  condition: (id: string): WorkflowNode => ({ id, type: 'condition', position: at, name: id }),
  end: (id = 'end', outcome: 'approved' | 'rejected' = 'approved'): WorkflowNode => ({
    id,
    type: 'end',
    position: at,
    outcome,
  }),
};

let edgeCounter = 0;
export const edge = (
  source: string,
  target: string,
  extra: Partial<WorkflowEdge> = {},
): WorkflowEdge => ({
  id: `e${++edgeCounter}`,
  source,
  target,
  rule: null,
  isDefault: false,
  ...extra,
});

export const field = (
  id: string,
  type: FormField['type'] = 'text',
  required = true,
): FormField => ({
  id,
  label: id,
  type,
  required,
});

/** start → each approval in order → approved */
export function chain(approvals: WorkflowNode[], fields: FormField[] = []): WorkflowDefinition {
  const nodes = [node.start(), ...approvals, node.end()];
  const edges = nodes.slice(1).map((n, i) => edge(nodes[i]!.id, n.id));
  return { form: { fields }, nodes, edges };
}

export async function publishWorkflow(
  world: World,
  definition: WorkflowDefinition,
  name = `WF ${++counter}`,
) {
  const created = await world.admin.agent
    .post(`/orgs/${world.orgId}/workflows`)
    .send({ name })
    .expect(201);
  const id: string = created.body.id;
  await world.admin.agent
    .put(`/orgs/${world.orgId}/workflows/${id}/draft`)
    .send({ definition })
    .expect(200);
  await world.admin.agent.post(`/orgs/${world.orgId}/workflows/${id}/publish`).expect(201);
  return id;
}

export async function submit(
  world: World,
  person: Person,
  workflowId: string,
  data: Record<string, unknown> = {},
) {
  const res = await person.agent
    .post(`/orgs/${world.orgId}/requests`)
    .send({ workflowId, title: 'Test request', data })
    .expect(201);
  return res.body.id as string;
}

export async function openTaskId(world: World, person: Person, requestId: string): Promise<string> {
  const res = await person.agent.get(`/orgs/${world.orgId}/tasks`).expect(200);
  const task = (res.body as { id: string; requestId: string }[]).find(
    (t) => t.requestId === requestId,
  );
  if (!task) throw new Error('No open task for this person on that request');
  return task.id;
}

export async function decide(
  world: World,
  person: Person,
  requestId: string,
  decision: 'approve' | 'reject' | 'send_back' = 'approve',
  comment?: string,
) {
  const taskId = await openTaskId(world, person, requestId);
  return person.agent
    .post(`/orgs/${world.orgId}/tasks/${taskId}/decision`)
    .send({ decision, comment })
    .expect(200);
}

export async function getRequest(world: World, person: Person, requestId: string) {
  const res = await person.agent.get(`/orgs/${world.orgId}/requests/${requestId}`).expect(200);
  return res.body as {
    status: string;
    currentStepId: string | null;
    tasks: { stepId: string; status: string; assignee: { id: string }; activation: number }[];
    history: { action: string; details: Record<string, unknown> }[];
    workflow: { version: number };
    permissions: { canResubmit: boolean; canWithdraw: boolean };
  };
}
