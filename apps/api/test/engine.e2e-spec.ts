import {
  addMember,
  chain,
  createOrg,
  createTestApp,
  decide,
  edge,
  field,
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

describe('Workflow engine (through the API)', () => {
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

  it('routes a request to the manager and approves it', async () => {
    const wf = await publishWorkflow(world, chain([node.approval('mgr', { kind: 'manager' })]));
    const requestId = await submit(world, employee, wf);

    let detail = await getRequest(world, employee, requestId);
    expect(detail.status).toBe('in_progress');
    expect(detail.tasks).toEqual([
      expect.objectContaining({
        assignee: { id: manager.id, name: 'Maria Manager' },
        status: 'pending',
      }),
    ]);
    expect(t.effects.emailsTo(manager.id).map((e) => e.template)).toEqual(['task_assigned']);

    await decide(world, manager, requestId, 'approve');
    detail = await getRequest(world, employee, requestId);
    expect(detail.status).toBe('approved');
    expect(detail.history.map((h) => h.action)).toEqual([
      'request_submitted',
      'step_started',
      'task_approved',
      'step_completed',
      'request_approved',
    ]);
    expect(t.effects.emailsTo(employee.id).map((e) => e.template)).toEqual(['request_completed']);
  });

  it('follows a condition: big purchases also need finance', async () => {
    const finance = await addMember(t, world, 'Frank Finance', ['approver']);
    const definition = {
      form: { fields: [field('cost', 'number')] },
      nodes: [
        node.start(),
        node.approval('mgr', { kind: 'manager' }),
        node.condition('check'),
        node.approval('finance', { kind: 'users', userIds: [finance.id] }),
        node.end(),
      ],
      edges: [
        edge('start', 'mgr'),
        edge('mgr', 'check'),
        edge('check', 'finance', { rule: { field: 'cost', operator: 'gt', value: 1000 } }),
        edge('check', 'end', { isDefault: true }),
        edge('finance', 'end'),
      ],
    };
    const wf = await publishWorkflow(world, definition);

    const small = await submit(world, employee, wf, { cost: 400 });
    await decide(world, manager, small);
    expect((await getRequest(world, employee, small)).status).toBe('approved');

    const big = await submit(world, employee, wf, { cost: 2500 });
    await decide(world, manager, big);
    const detail = await getRequest(world, employee, big);
    expect(detail.status).toBe('in_progress');
    expect(detail.currentStepId).toBe('finance');
    await decide(world, finance, big);
    expect((await getRequest(world, employee, big)).status).toBe('approved');
  });

  it('can reject automatically from a condition, without anyone deciding', async () => {
    const definition = {
      form: { fields: [field('cost', 'number')] },
      nodes: [
        node.start(),
        node.condition('limit'),
        node.approval('mgr', { kind: 'manager' }),
        node.end(),
        node.end('too_much', 'rejected'),
      ],
      edges: [
        edge('start', 'limit'),
        edge('limit', 'too_much', { rule: { field: 'cost', operator: 'gt', value: 10000 } }),
        edge('limit', 'mgr', { isDefault: true }),
        edge('mgr', 'end'),
      ],
    };
    const wf = await publishWorkflow(world, definition);
    const id = await submit(world, employee, wf, { cost: 20000 });
    const detail = await getRequest(world, employee, id);
    expect(detail.status).toBe('rejected');
    expect(detail.tasks).toEqual([]);
  });

  it('validates form answers against the published form', async () => {
    const wf = await publishWorkflow(
      world,
      chain([node.approval('mgr', { kind: 'manager' })], [field('cost', 'number')]),
    );
    const res = await employee.agent
      .post(`/orgs/${world.orgId}/requests`)
      .send({ workflowId: wf, title: 'Bad', data: { cost: 'a lot' } })
      .expect(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [expect.objectContaining({ path: 'cost' })],
    });
  });

  describe('"all" and "any" steps', () => {
    let a: Person;
    let b: Person;
    let c: Person;

    beforeEach(async () => {
      a = await addMember(t, world, 'Ann', ['approver']);
      b = await addMember(t, world, 'Ben', ['approver']);
      c = await addMember(t, world, 'Cal', ['approver']);
    });

    it('"all" waits for every approver', async () => {
      const wf = await publishWorkflow(
        world,
        chain([
          node.approval('board', { kind: 'users', userIds: [a.id, b.id, c.id] }, { mode: 'all' }),
        ]),
      );
      const id = await submit(world, employee, wf);
      await decide(world, a, id);
      await decide(world, b, id);
      expect((await getRequest(world, employee, id)).status).toBe('in_progress');
      await decide(world, c, id);
      expect((await getRequest(world, employee, id)).status).toBe('approved');
    });

    it('"any": the first approval wins and the other tasks are skipped', async () => {
      const wf = await publishWorkflow(
        world,
        chain([node.approval('pool', { kind: 'users', userIds: [a.id, b.id, c.id] })]),
      );
      const id = await submit(world, employee, wf);
      await decide(world, b, id);
      const detail = await getRequest(world, employee, id);
      expect(detail.status).toBe('approved');
      expect(detail.tasks.map((task) => task.status).sort()).toEqual([
        'approved',
        'skipped',
        'skipped',
      ]);
    });

    it('rule 2: one rejection ends the request, even in an "all" step', async () => {
      const wf = await publishWorkflow(
        world,
        chain([
          node.approval('board', { kind: 'users', userIds: [a.id, b.id, c.id] }, { mode: 'all' }),
        ]),
      );
      const id = await submit(world, employee, wf);
      await decide(world, a, id);
      await decide(world, b, id, 'reject', 'Over budget');
      const detail = await getRequest(world, employee, id);
      expect(detail.status).toBe('rejected');
      expect(detail.tasks.find((task) => task.assignee.id === c.id)?.status).toBe('skipped');
    });

    it('a role step asks everyone with that role', async () => {
      const wf = await publishWorkflow(
        world,
        chain([node.approval('approvers', { kind: 'role', role: 'approver' })]),
      );
      const id = await submit(world, employee, wf);
      const assignees = (await getRequest(world, employee, id)).tasks
        .map((task) => task.assignee.id)
        .sort();
      // The founder got every role at sign-up, so they are an approver too.
      expect(assignees).toEqual([a.id, b.id, c.id, manager.id, world.admin.id].sort());
    });
  });

  describe('send back and resubmit (rule 1)', () => {
    it('returns to the step that sent it back, not to the start', async () => {
      const second = await addMember(t, world, 'Sam Second', ['approver']);
      const wf = await publishWorkflow(
        world,
        chain(
          [
            node.approval('mgr', { kind: 'manager' }),
            node.approval('second', { kind: 'users', userIds: [second.id] }),
          ],
          [field('reason')],
        ),
      );
      const id = await submit(world, employee, wf, { reason: 'first try' });
      await decide(world, manager, id);
      await decide(world, second, id, 'send_back', 'Add the quote please');

      let detail = await getRequest(world, employee, id);
      expect(detail.status).toBe('changes_requested');
      expect(detail.permissions).toEqual({ canResubmit: true, canWithdraw: true });
      expect(t.effects.emailsTo(employee.id).at(-1)).toMatchObject({
        template: 'changes_requested',
        vars: { comment: 'Add the quote please' },
      });

      await employee.agent
        .post(`/orgs/${world.orgId}/requests/${id}/resubmit`)
        .send({ data: { reason: 'with the quote' } })
        .expect(200);
      detail = await getRequest(world, employee, id);
      expect(detail.status).toBe('in_progress');
      expect(detail.currentStepId).toBe('second');
      // The manager is not asked again.
      expect(detail.tasks.filter((task) => task.assignee.id === manager.id)).toHaveLength(1);
      await decide(world, second, id);
      expect((await getRequest(world, employee, id)).status).toBe('approved');
    });

    it('requires a comment when sending back or rejecting', async () => {
      const wf = await publishWorkflow(world, chain([node.approval('mgr', { kind: 'manager' })]));
      const id = await submit(world, employee, wf);
      const taskId = await openTaskId(world, manager, id);
      const res = await manager.agent
        .post(`/orgs/${world.orgId}/tasks/${taskId}/decision`)
        .send({ decision: 'send_back' })
        .expect(400);
      expect(res.body.error.details[0].path).toBe('comment');
    });

    it('only the requester can resubmit, and only after a send back', async () => {
      const wf = await publishWorkflow(world, chain([node.approval('mgr', { kind: 'manager' })]));
      const id = await submit(world, employee, wf);
      const early = await employee.agent
        .post(`/orgs/${world.orgId}/requests/${id}/resubmit`)
        .send({ data: {} })
        .expect(409);
      expect(early.body.error.code).toBe('INVALID_TRANSITION');
      await manager.agent
        .post(`/orgs/${world.orgId}/requests/${id}/resubmit`)
        .send({ data: {} })
        .expect(404);
    });
  });

  describe('withdraw', () => {
    it('cancels the request and closes open tasks', async () => {
      const wf = await publishWorkflow(world, chain([node.approval('mgr', { kind: 'manager' })]));
      const id = await submit(world, employee, wf);
      await employee.agent.post(`/orgs/${world.orgId}/requests/${id}/withdraw`).expect(200);
      const detail = await getRequest(world, employee, id);
      expect(detail.status).toBe('cancelled');
      expect(detail.tasks[0]?.status).toBe('skipped');
      const inbox = await manager.agent.get(`/orgs/${world.orgId}/tasks`).expect(200);
      expect(inbox.body).toEqual([]);
    });

    it('cannot withdraw a finished request', async () => {
      const wf = await publishWorkflow(world, chain([node.approval('mgr', { kind: 'manager' })]));
      const id = await submit(world, employee, wf);
      await decide(world, manager, id);
      const res = await employee.agent
        .post(`/orgs/${world.orgId}/requests/${id}/withdraw`)
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_TRANSITION');
    });
  });

  describe('separation of duties (rule 4)', () => {
    it("a manager's own request goes to their manager, not to themselves", async () => {
      const director = await addMember(t, world, 'Dina Director', ['approver']);
      await world.admin.agent
        .patch(`/orgs/${world.orgId}/members/${manager.id}`)
        .send({ managerId: director.id })
        .expect(200);
      const wf = await publishWorkflow(
        world,
        chain([node.approval('pool', { kind: 'users', userIds: [manager.id] })]),
      );
      const id = await submit(world, manager, wf);
      const detail = await getRequest(world, manager, id);
      expect(detail.tasks.map((task) => task.assignee.id)).toEqual([director.id]);
      expect(detail.history.find((h) => h.action === 'step_started')?.details.substituted).toBe(
        true,
      );
    });

    it('falls back to admins (never the requester) when there is no manager', async () => {
      const wf = await publishWorkflow(world, chain([node.approval('mgr', { kind: 'manager' })]));
      const id = await submit(world, manager, wf); // the manager has no manager
      const detail = await getRequest(world, manager, id);
      expect(detail.tasks.map((task) => task.assignee.id)).toEqual([world.admin.id]);
    });

    it('fails clearly when nobody else could approve', async () => {
      const wf = await publishWorkflow(world, chain([node.approval('mgr', { kind: 'manager' })]));
      const res = await world.admin.agent
        .post(`/orgs/${world.orgId}/requests`)
        .send({ workflowId: wf, title: 'Self', data: {} })
        .expect(422);
      expect(res.body.error.code).toBe('NO_ELIGIBLE_APPROVER');
      const list = await world.admin.agent
        .get(`/orgs/${world.orgId}/requests?scope=all`)
        .expect(200);
      expect(list.body).toEqual([]); // the whole submission was rolled back
    });
  });

  describe('versioning (rule 5)', () => {
    it('running requests keep their version when the workflow is edited', async () => {
      const second = await addMember(t, world, 'Sam Second', ['approver']);
      const wf = await publishWorkflow(world, chain([node.approval('mgr', { kind: 'manager' })]));
      const oldRequest = await submit(world, employee, wf);

      // Version 2 adds a second approval step.
      await world.admin.agent
        .put(`/orgs/${world.orgId}/workflows/${wf}/draft`)
        .send({
          definition: chain([
            node.approval('mgr', { kind: 'manager' }),
            node.approval('second', { kind: 'users', userIds: [second.id] }),
          ]),
        })
        .expect(200);
      await world.admin.agent.post(`/orgs/${world.orgId}/workflows/${wf}/publish`).expect(201);
      const newRequest = await submit(world, employee, wf);

      await decide(world, manager, oldRequest);
      await decide(world, manager, newRequest);
      expect(await getRequest(world, employee, oldRequest)).toMatchObject({
        status: 'approved',
        workflow: { version: 1 },
      });
      expect(await getRequest(world, employee, newRequest)).toMatchObject({
        status: 'in_progress',
        currentStepId: 'second',
        workflow: { version: 2 },
      });
    });
  });

  describe('task and request access', () => {
    it("can't decide someone else's task, or the same task twice", async () => {
      const wf = await publishWorkflow(world, chain([node.approval('mgr', { kind: 'manager' })]));
      const id = await submit(world, employee, wf);
      const taskId = await openTaskId(world, manager, id);
      await employee.agent
        .post(`/orgs/${world.orgId}/tasks/${taskId}/decision`)
        .send({ decision: 'approve' })
        .expect(404);
      await manager.agent
        .post(`/orgs/${world.orgId}/tasks/${taskId}/decision`)
        .send({ decision: 'approve' })
        .expect(200);
      const again = await manager.agent
        .post(`/orgs/${world.orgId}/tasks/${taskId}/decision`)
        .send({ decision: 'reject', comment: 'x' })
        .expect(409);
      expect(again.body.error.code).toBe('TASK_ALREADY_DECIDED');
    });

    it('only the requester, assignees and admins can see a request', async () => {
      const other = await addMember(t, world, 'Olly Other');
      const wf = await publishWorkflow(world, chain([node.approval('mgr', { kind: 'manager' })]));
      const id = await submit(world, employee, wf);
      await other.agent.get(`/orgs/${world.orgId}/requests/${id}`).expect(404);
      await manager.agent.get(`/orgs/${world.orgId}/requests/${id}`).expect(200);
      await world.admin.agent.get(`/orgs/${world.orgId}/requests/${id}`).expect(200);
    });

    it('lists my requests, and all requests for admins only', async () => {
      const wf = await publishWorkflow(world, chain([node.approval('mgr', { kind: 'manager' })]));
      await submit(world, employee, wf);
      const mine = await employee.agent.get(`/orgs/${world.orgId}/requests`).expect(200);
      expect(mine.body).toHaveLength(1);
      expect(
        (await manager.agent.get(`/orgs/${world.orgId}/requests`).expect(200)).body,
      ).toHaveLength(0);
      await employee.agent.get(`/orgs/${world.orgId}/requests?scope=all`).expect(403);
      expect(
        (await world.admin.agent.get(`/orgs/${world.orgId}/requests?scope=all`).expect(200)).body,
      ).toHaveLength(1);
    });

    it('shows decided tasks in the "done" inbox', async () => {
      const wf = await publishWorkflow(world, chain([node.approval('mgr', { kind: 'manager' })]));
      const id = await submit(world, employee, wf);
      await decide(world, manager, id);
      const done = await manager.agent.get(`/orgs/${world.orgId}/tasks?status=done`).expect(200);
      expect(done.body).toEqual([expect.objectContaining({ requestId: id, status: 'approved' })]);
    });

    it('cannot submit to an unpublished workflow', async () => {
      const created = await world.admin.agent
        .post(`/orgs/${world.orgId}/workflows`)
        .send({ name: 'Draft only' })
        .expect(201);
      await employee.agent
        .post(`/orgs/${world.orgId}/requests`)
        .send({ workflowId: created.body.id, title: 'x', data: {} })
        .expect(404);
    });
  });
});
