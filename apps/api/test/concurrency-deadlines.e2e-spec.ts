import { eq, sql } from 'drizzle-orm';
import { auditEvents, tasks, workflowVersions } from '../src/core/db/schema';
import {
  addMember,
  chain,
  createOrg,
  createTestApp,
  getRequest,
  node,
  openTaskId,
  publishWorkflow,
  resetDb,
  submit,
  type Person,
  type TestApp,
  type World,
} from './helpers';

describe('Concurrency, deadlines and integrity', () => {
  let t: TestApp;
  let world: World;
  let manager: Person;
  let employee: Person;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  beforeEach(async () => {
    await resetDb(t.db);
    t.effects.reset();
    world = await createOrg(t);
    manager = await addMember(t, world, 'Maria Manager', ['approver', 'employee']);
    employee = await addMember(t, world, 'Emma Employee', ['employee'], manager.id);
  });

  const auditCount = async (requestId: string, action: string) => {
    const [row] = await t.db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditEvents)
      .where(sql`${auditEvents.requestId} = ${requestId} and ${auditEvents.action} = ${action}`);
    return row?.n ?? 0;
  };

  describe('simultaneous approvals', () => {
    let approvers: Person[];

    beforeEach(async () => {
      approvers = [];
      for (const name of ['A1', 'A2', 'A3', 'A4', 'A5']) {
        approvers.push(await addMember(t, world, name, ['approver']));
      }
    });

    const approveAllAtOnce = async (requestId: string) => {
      const taskIds = await Promise.all(approvers.map((p) => openTaskId(world, p, requestId)));
      return Promise.all(
        approvers.map((p, i) =>
          p.agent
            .post(`/orgs/${world.orgId}/tasks/${taskIds[i]}/decision`)
            .send({ decision: 'approve' }),
        ),
      );
    };

    it('"any" step: 5 approvals at the same moment move the request exactly once', async () => {
      const wf = await publishWorkflow(
        world,
        chain([node.approval('pool', { kind: 'users', userIds: approvers.map((p) => p.id) })]),
      );
      const id = await submit(world, employee, wf);
      const responses = await approveAllAtOnce(id);

      const statuses = responses.map((r) => r.status).sort();
      expect(statuses).toEqual([200, 409, 409, 409, 409]);
      expect(
        responses
          .filter((r) => r.status === 409)
          .every((r) => r.body.error.code === 'TASK_ALREADY_DECIDED'),
      ).toBe(true);
      expect(await auditCount(id, 'step_completed')).toBe(1);
      expect(await auditCount(id, 'request_approved')).toBe(1);
    });

    it('"all" step: 5 approvals at the same moment complete the step exactly once', async () => {
      const wf = await publishWorkflow(
        world,
        chain([
          node.approval(
            'board',
            { kind: 'users', userIds: approvers.map((p) => p.id) },
            { mode: 'all' },
          ),
        ]),
      );
      const id = await submit(world, employee, wf);
      const responses = await approveAllAtOnce(id);

      expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
      expect((await getRequest(world, employee, id)).status).toBe('approved');
      expect(await auditCount(id, 'step_completed')).toBe(1);
      expect(await auditCount(id, 'request_approved')).toBe(1);
    });

    it('approve and withdraw at the same moment: exactly one wins', async () => {
      const wf = await publishWorkflow(world, chain([node.approval('mgr', { kind: 'manager' })]));
      const id = await submit(world, employee, wf);
      const taskId = await openTaskId(world, manager, id);
      const [approve, withdraw] = await Promise.all([
        manager.agent
          .post(`/orgs/${world.orgId}/tasks/${taskId}/decision`)
          .send({ decision: 'approve' }),
        employee.agent.post(`/orgs/${world.orgId}/requests/${id}/withdraw`),
      ]);
      expect([approve.status, withdraw.status].sort()).toEqual([200, 409]);
      const final = (await getRequest(world, employee, id)).status;
      expect(final).toBe(approve.status === 200 ? 'approved' : 'cancelled');
    });
  });

  describe('deadline sweep', () => {
    const deadlineWorkflow = () =>
      publishWorkflow(
        world,
        chain([node.approval('mgr', { kind: 'manager' }, { dueInHours: 24 })]),
      );

    it('reminds once at 3/4 of the time, then escalates once after the deadline', async () => {
      const id = await submit(world, employee, await deadlineWorkflow());

      t.clock.advanceHours(17);
      expect(await t.engine.runDeadlineSweep()).toEqual({ escalated: 0, reminded: 0 });
      t.clock.advanceHours(2); // 19h: past the 18h reminder point
      expect(await t.engine.runDeadlineSweep()).toEqual({ escalated: 0, reminded: 1 });
      expect(await t.engine.runDeadlineSweep()).toEqual({ escalated: 0, reminded: 0 });
      expect(t.effects.emailsTo(manager.id).map((e) => e.template)).toEqual([
        'task_assigned',
        'task_reminder',
      ]);

      t.clock.advanceHours(6); // 25h: overdue
      expect(await t.engine.runDeadlineSweep()).toEqual({ escalated: 1, reminded: 0 });
      expect(await t.engine.runDeadlineSweep()).toEqual({ escalated: 0, reminded: 0 });

      // The manager has no manager, so the admins take over.
      const detail = await getRequest(world, employee, id);
      expect(detail.tasks.map((task) => [task.assignee.id, task.status])).toEqual([
        [manager.id, 'escalated'],
        [world.admin.id, 'pending'],
      ]);
      expect(t.effects.emailsTo(world.admin.id).map((e) => e.template)).toEqual(['task_escalated']);
      expect(detail.history.find((h) => h.action === 'task_escalated')?.details.reason).toBe(
        'deadline',
      );

      // The new assignee can finish the request.
      const taskId = await openTaskId(world, world.admin, id);
      await world.admin.agent
        .post(`/orgs/${world.orgId}/tasks/${taskId}/decision`)
        .send({ decision: 'approve' })
        .expect(200);
      expect((await getRequest(world, employee, id)).status).toBe('approved');
    });

    it('escalates to the assignee’s own manager when there is one', async () => {
      const director = await addMember(t, world, 'Dina Director', ['approver']);
      await world.admin.agent
        .patch(`/orgs/${world.orgId}/members/${manager.id}`)
        .send({ managerId: director.id })
        .expect(200);
      const id = await submit(world, employee, await deadlineWorkflow());
      t.clock.advanceHours(25);
      await t.engine.runDeadlineSweep();
      const pending = (await getRequest(world, employee, id)).tasks.filter(
        (task) => task.status === 'pending',
      );
      expect(pending.map((task) => task.assignee.id)).toEqual([director.id]);
    });

    it('does nothing for tasks decided before the deadline', async () => {
      const id = await submit(world, employee, await deadlineWorkflow());
      const taskId = await openTaskId(world, manager, id);
      await manager.agent
        .post(`/orgs/${world.orgId}/tasks/${taskId}/decision`)
        .send({ decision: 'approve' })
        .expect(200);
      t.clock.advanceHours(48);
      expect(await t.engine.runDeadlineSweep()).toEqual({ escalated: 0, reminded: 0 });
    });

    it('stops the clock when there is nobody to escalate to', async () => {
      // The employee reports to the only admin, who has no manager.
      await world.admin.agent
        .patch(`/orgs/${world.orgId}/members/${employee.id}`)
        .send({ managerId: world.admin.id })
        .expect(200);
      const id = await submit(world, employee, await deadlineWorkflow());
      t.clock.advanceHours(25);
      expect(await t.engine.runDeadlineSweep()).toEqual({ escalated: 0, reminded: 0 });
      const [task] = await t.db.select().from(tasks).where(eq(tasks.requestId, id));
      expect(task).toMatchObject({ status: 'pending', dueAt: null });
      expect((await getRequest(world, employee, id)).history.map((h) => h.action)).toContain(
        'escalation_skipped',
      );
    });
  });

  describe('database-level integrity', () => {
    it('rejects any update or delete of audit events', async () => {
      const wf = await publishWorkflow(world, chain([node.approval('mgr', { kind: 'manager' })]));
      await submit(world, employee, wf);
      await expect(t.db.update(auditEvents).set({ action: 'tampered' })).rejects.toThrow();
      await expect(t.db.delete(auditEvents)).rejects.toThrow();
    });

    it('rejects changes to published versions but allows editing drafts', async () => {
      const wf = await publishWorkflow(world, chain([node.approval('mgr', { kind: 'manager' })]));
      await expect(
        t.db
          .update(workflowVersions)
          .set({ updatedAt: new Date() })
          .where(eq(workflowVersions.workflowId, wf)),
      ).rejects.toThrow();
      await world.admin.agent
        .put(`/orgs/${world.orgId}/workflows/${wf}/draft`)
        .send({ definition: chain([node.approval('mgr2', { kind: 'manager' })]) })
        .expect(200);
      await expect(
        t.db
          .update(workflowVersions)
          .set({ updatedAt: new Date() })
          .where(
            sql`${workflowVersions.workflowId} = ${wf} and ${workflowVersions.status} = 'draft'`,
          ),
      ).resolves.toBeDefined();
    });
  });
});
