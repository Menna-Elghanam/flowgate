import 'reflect-metadata';
import type {
  FormField,
  Role,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from '@flowgate/workflow';
import { Injectable, Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { eq, sql } from 'drizzle-orm';
import { hashPassword } from '../../modules/auth/password';
import { EngineModule } from '../../engine/engine.module';
import { EngineService } from '../../engine/engine.service';
import type { OrgMember } from '../auth/context';
import { Clock } from '../clock';
import { EffectsModule, NoopEffectsRunner } from '../effects/effects.module';
import { recordAudit } from './audit';
import { DB, DbModule, type Db } from './db.module';
import { memberships, organizations, tasks, users, workflows, workflowVersions } from './schema';

/** A clock the seed script moves through the past, so the demo has realistic history. */
@Injectable()
class SeedClock extends Clock {
  private current = new Date();
  override now(): Date {
    return new Date(this.current);
  }
  set(date: Date): void {
    this.current = date;
  }
}

@Module({
  imports: [DbModule, EffectsModule.forRoot(NoopEffectsRunner, SeedClock), EngineModule],
})
class SeedModule {}

export const DEMO_PASSWORD = 'flowgate-demo';
const HOUR = 3_600_000;

// ------------------------------------------------------------ workflow designs

const pos = (x: number, y: number) => ({ x, y });
let edgeId = 0;
const e = (source: string, target: string, extra: Partial<WorkflowEdge> = {}): WorkflowEdge => ({
  id: `e${++edgeId}`,
  source,
  target,
  rule: null,
  isDefault: false,
  ...extra,
});
const f = (
  id: string,
  label: string,
  type: FormField['type'],
  required = true,
  options?: string[],
): FormField => ({
  id,
  label,
  type,
  required,
  ...(options ? { options } : {}),
});

function laptopWorkflow(financeId: string): WorkflowDefinition {
  const nodes: WorkflowNode[] = [
    { id: 'start', type: 'start', position: pos(250, 0) },
    {
      id: 'manager',
      type: 'approval',
      position: pos(250, 110),
      name: 'Manager approval',
      assignee: { kind: 'manager' },
      mode: 'any',
      dueInHours: 48,
    },
    { id: 'cost_check', type: 'condition', position: pos(250, 240), name: 'Cost over $1,500?' },
    {
      id: 'finance',
      type: 'approval',
      position: pos(450, 370),
      name: 'Finance approval',
      assignee: { kind: 'users', userIds: [financeId] },
      mode: 'any',
      dueInHours: 24,
    },
    { id: 'approved', type: 'end', position: pos(250, 500), outcome: 'approved' },
  ];
  return {
    form: {
      fields: [
        f('model', 'Model', 'select', true, [
          'MacBook Air',
          'MacBook Pro',
          'ThinkPad X1',
          'Dell XPS',
        ]),
        f('cost', 'Cost (USD)', 'number'),
        f('needed_by', 'Needed by', 'date', false),
        f('reason', 'Why do you need it?', 'textarea'),
      ],
    },
    nodes,
    edges: [
      e('start', 'manager'),
      e('manager', 'cost_check'),
      e('cost_check', 'finance', { rule: { field: 'cost', operator: 'gt', value: 1500 } }),
      e('cost_check', 'approved', { isDefault: true }),
      e('finance', 'approved'),
    ],
  };
}

function purchaseWorkflow(financeId: string, legalId: string): WorkflowDefinition {
  return {
    form: {
      fields: [
        f('item', 'What are you buying?', 'text'),
        f('category', 'Category', 'select', true, ['Software', 'Hardware', 'Services', 'Events']),
        f('amount', 'Amount (USD)', 'number'),
        f('vendor', 'Vendor', 'text'),
        f('notes', 'Notes', 'textarea', false),
      ],
    },
    nodes: [
      { id: 'start', type: 'start', position: pos(250, 0) },
      { id: 'limit', type: 'condition', position: pos(250, 110), name: 'Over $25,000?' },
      { id: 'over_limit', type: 'end', position: pos(0, 240), outcome: 'rejected' },
      {
        id: 'manager',
        type: 'approval',
        position: pos(250, 240),
        name: 'Manager approval',
        assignee: { kind: 'manager' },
        mode: 'any',
        dueInHours: 48,
      },
      { id: 'big', type: 'condition', position: pos(250, 370), name: 'Over $5,000?' },
      {
        id: 'finance_legal',
        type: 'approval',
        position: pos(450, 500),
        name: 'Finance & Legal',
        assignee: { kind: 'users', userIds: [financeId, legalId] },
        mode: 'all',
        dueInHours: 72,
      },
      { id: 'approved', type: 'end', position: pos(250, 630), outcome: 'approved' },
    ],
    edges: [
      e('start', 'limit'),
      e('limit', 'over_limit', { rule: { field: 'amount', operator: 'gt', value: 25000 } }),
      e('limit', 'manager', { isDefault: true }),
      e('manager', 'big'),
      e('big', 'finance_legal', { rule: { field: 'amount', operator: 'gt', value: 5000 } }),
      e('big', 'approved', { isDefault: true }),
      e('finance_legal', 'approved'),
    ],
  };
}

function leaveWorkflow(): WorkflowDefinition {
  return {
    form: {
      fields: [
        f('type', 'Type of leave', 'select', true, ['Vacation', 'Sick', 'Unpaid']),
        f('first_day', 'First day', 'date'),
        f('days', 'Working days', 'number'),
        f('note', 'Note', 'textarea', false),
      ],
    },
    nodes: [
      { id: 'start', type: 'start', position: pos(250, 0) },
      {
        id: 'manager',
        type: 'approval',
        position: pos(250, 110),
        name: 'Manager approval',
        assignee: { kind: 'manager' },
        mode: 'any',
        dueInHours: 24,
      },
      { id: 'long', type: 'condition', position: pos(250, 240), name: 'More than 10 days?' },
      {
        id: 'hr',
        type: 'approval',
        position: pos(450, 370),
        name: 'HR approval',
        assignee: { kind: 'role', role: 'admin' },
        mode: 'any',
        dueInHours: 48,
      },
      { id: 'approved', type: 'end', position: pos(250, 500), outcome: 'approved' },
    ],
    edges: [
      e('start', 'manager'),
      e('manager', 'long'),
      e('long', 'hr', { rule: { field: 'days', operator: 'gt', value: 10 } }),
      e('long', 'approved', { isDefault: true }),
      e('hr', 'approved'),
    ],
  };
}

// ------------------------------------------------------------ seeding

async function seed(db: Db, engine: EngineService, clock: SeedClock, reset: boolean) {
  const [existing] = await db.select().from(users).where(eq(users.email, 'alex@acme.test'));
  if (existing && !reset) {
    throw new Error(
      'Demo data already exists. Run `pnpm db:reset` to wipe the database and seed again.',
    );
  }
  if (reset) {
    await db.execute(sql`TRUNCATE audit_events, tasks, requests, workflow_versions, workflows,
      invites, memberships, sessions, organizations, users RESTART IDENTITY CASCADE`);
  }

  const now = Date.now();
  const at = (hoursAgo: number) => clock.set(new Date(now - hoursAgo * HOUR));
  at(24 * 30);

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const [org] = await db
    .insert(organizations)
    .values({ name: 'Acme Corp', createdAt: clock.now() })
    .returning();
  if (!org) throw new Error('Could not create organization');

  const people: Record<string, { name: string; roles: Role[]; manager?: string }> = {
    alex: { name: 'Alex Morgan', roles: ['admin', 'approver', 'employee'] },
    maria: { name: 'Maria Chen', roles: ['approver', 'employee'], manager: 'alex' },
    frank: { name: 'Frank Osei', roles: ['approver', 'employee'], manager: 'alex' },
    lena: { name: 'Lena Fischer', roles: ['approver', 'employee'], manager: 'alex' },
    emma: { name: 'Emma Davis', roles: ['employee'], manager: 'maria' },
    noah: { name: 'Noah Patel', roles: ['employee'], manager: 'maria' },
  };
  const ids: Record<string, string> = {};
  for (const [key, person] of Object.entries(people)) {
    const [user] = await db
      .insert(users)
      .values({
        email: `${key}@acme.test`,
        name: person.name,
        passwordHash,
        createdAt: clock.now(),
      })
      .returning();
    if (!user) throw new Error('Could not create user');
    ids[key] = user.id;
  }
  const id = (key: string) => {
    const value = ids[key];
    if (!value) throw new Error(`Unknown person ${key}`);
    return value;
  };
  for (const [key, person] of Object.entries(people)) {
    await db.insert(memberships).values({
      orgId: org.id,
      userId: id(key),
      roles: person.roles,
      managerId: person.manager ? id(person.manager) : null,
      createdAt: clock.now(),
    });
  }
  const member = (key: string): OrgMember => ({
    orgId: org.id,
    userId: id(key),
    roles: people[key]?.roles ?? [],
    managerId: people[key]?.manager ? id(people[key].manager) : null,
  });

  const publish = async (name: string, description: string, definition: WorkflowDefinition) => {
    const [workflow] = await db
      .insert(workflows)
      .values({
        orgId: org.id,
        name,
        description,
        createdBy: id('alex'),
        createdAt: clock.now(),
        updatedAt: clock.now(),
      })
      .returning();
    if (!workflow) throw new Error('Could not create workflow');
    const [version] = await db
      .insert(workflowVersions)
      .values({
        workflowId: workflow.id,
        orgId: org.id,
        version: 1,
        status: 'published',
        definition,
        createdAt: clock.now(),
        publishedAt: clock.now(),
        publishedBy: id('alex'),
      })
      .returning();
    if (!version) throw new Error('Could not create version');
    await db
      .update(workflows)
      .set({ publishedVersionId: version.id })
      .where(eq(workflows.id, workflow.id));
    for (const action of ['workflow_created', 'workflow_published']) {
      await recordAudit(db, {
        orgId: org.id,
        workflowId: workflow.id,
        actorId: id('alex'),
        action,
        details: { name, ...(action === 'workflow_published' ? { version: 1 } : {}) },
        createdAt: clock.now(),
      });
    }
    return workflow.id;
  };

  const laptop = await publish(
    'Laptop request',
    'New or replacement laptops. Over $1,500 also needs Finance.',
    laptopWorkflow(id('frank')),
  );
  const purchase = await publish(
    'Purchase request',
    'Software, hardware, services and events. Over $5,000 needs Finance and Legal.',
    purchaseWorkflow(id('frank'), id('lena')),
  );
  const leave = await publish(
    'Leave request',
    'Vacation, sick and unpaid leave. More than 10 days also needs HR.',
    leaveWorkflow(),
  );

  const submit = (who: string, workflowId: string, title: string, data: Record<string, unknown>) =>
    engine.submit(member(who), { workflowId, title, data }).then((r) => r.id);
  const act = async (
    who: string,
    requestId: string,
    decision: 'approve' | 'reject' | 'send_back',
    comment: string | null = null,
  ) => {
    const [task] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        sql`${tasks.requestId} = ${requestId} and ${tasks.assigneeId} = ${id(who)} and ${tasks.status} = 'pending'`,
      );
    if (!task) throw new Error(`${who} has no open task on ${requestId}`);
    await engine.decide(member(who), task.id, decision, comment);
  };

  // Approved through two steps (manager, then finance because it's over $1,500).
  at(24 * 12);
  const r1 = await submit('emma', laptop, 'MacBook Pro for design work', {
    model: 'MacBook Pro',
    cost: 2400,
    needed_by: null,
    reason: 'My current laptop struggles with large Figma files.',
  });
  at(24 * 12 - 5);
  await act('maria', r1, 'approve');
  at(24 * 11 - 2);
  await act('frank', r1, 'approve', 'Within the hardware budget.');

  // Approved by the manager only.
  at(24 * 9);
  const r2 = await submit('noah', laptop, 'ThinkPad replacement', {
    model: 'ThinkPad X1',
    cost: 1200,
    needed_by: null,
    reason: 'Battery no longer holds a charge.',
  });
  at(24 * 9 - 3);
  await act('maria', r2, 'approve');

  // Sent back, resubmitted with changes, then approved.
  at(24 * 7);
  const r3 = await submit('emma', purchase, 'Figma team licenses', {
    item: 'Figma Professional, 6 seats',
    category: 'Software',
    amount: 1800,
    vendor: 'Figma',
    notes: '',
  });
  at(24 * 7 - 4);
  await act('maria', r3, 'send_back', 'Please add the annual vs monthly price so we can compare.');
  at(24 * 6);
  await engine.resubmit(member('emma'), r3, {
    data: {
      item: 'Figma Professional, 6 seats',
      category: 'Software',
      amount: 1800,
      vendor: 'Figma',
      notes: 'Annual plan: $1,800. Monthly would be $2,160.',
    },
  });
  at(24 * 6 - 6);
  await act('maria', r3, 'approve');

  // Long leave: manager, then HR.
  at(24 * 5);
  const r4 = await submit('noah', leave, 'Summer vacation', {
    type: 'Vacation',
    first_day: '2026-12-21',
    days: 12,
    note: 'Visiting family.',
  });
  at(24 * 5 - 2);
  await act('maria', r4, 'approve');
  at(24 * 4);
  await act('alex', r4, 'approve');

  // Rejected by the manager.
  at(24 * 4);
  const r5 = await submit('emma', leave, 'Day off on launch day', {
    type: 'Vacation',
    first_day: '2026-11-20',
    days: 1,
    note: '',
  });
  at(24 * 4 - 1);
  await act('maria', r5, 'reject', 'That is our launch day. Could you pick another day?');

  // Automatically rejected: over the $25,000 limit.
  at(24 * 3);
  await submit('noah', purchase, 'Office renovation', {
    item: 'Meeting room renovation',
    category: 'Services',
    amount: 40000,
    vendor: 'BuildCo',
    notes: '',
  });

  // In progress at "Finance & Legal": finance approved, legal still to decide.
  at(24 * 2);
  const r7 = await submit('noah', purchase, 'Conference booth', {
    item: 'Booth at DevConf 2027',
    category: 'Events',
    amount: 12000,
    vendor: 'DevConf',
    notes: 'Includes 4 passes.',
  });
  at(24 * 2 - 3);
  await act('maria', r7, 'approve');
  at(24 * 1);
  await act('frank', r7, 'approve');

  // Overdue: the 48h deadline has passed, so the sweep escalates it to Maria's manager.
  at(50);
  await submit('emma', laptop, 'Dell XPS for the new hire', {
    model: 'Dell XPS',
    cost: 1700,
    needed_by: '2026-12-01',
    reason: 'For Sam, who starts next month.',
  });

  // Separation of duties: Maria's own request goes to her manager.
  at(6);
  await submit('maria', laptop, 'MacBook Air upgrade', {
    model: 'MacBook Air',
    cost: 1300,
    needed_by: null,
    reason: 'Mine is from 2019.',
  });

  // Fresh, waiting for Maria.
  at(2);
  await submit('noah', leave, 'Dentist appointment', {
    type: 'Sick',
    first_day: '2026-11-18',
    days: 1,
    note: '',
  });

  return Object.keys(people).map(
    (key) => `${people[key]?.name.padEnd(14)} ${key}@acme.test  (${people[key]?.roles.join(', ')})`,
  );
}

async function main() {
  const reset = process.argv.includes('--reset');
  const app = await NestFactory.createApplicationContext(SeedModule, { logger: ['error', 'warn'] });
  const logger = new Logger('Seed');
  try {
    const accounts = await seed(
      app.get<Db>(DB),
      app.get(EngineService),
      app.get(Clock) as SeedClock,
      reset,
    );
    logger.log('Demo data created.');
    console.log(`\nDemo accounts (password: ${DEMO_PASSWORD}):\n  ${accounts.join('\n  ')}\n`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
