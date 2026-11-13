import {
  addMember,
  chain,
  createOrg,
  createTestApp,
  getRequest,
  node,
  publishWorkflow,
  resetDb,
  submit,
  type TestApp,
} from './helpers';

describe('Auth', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => resetDb(t.db));

  const signup = {
    name: 'Ada',
    email: 'Ada@Example.com',
    password: 'password123',
    organizationName: 'Acme',
  };

  it('signs up, sets an httpOnly session cookie and returns the new organization', async () => {
    const agent = t.agent();
    const res = await agent.post('/auth/signup').send(signup).expect(201);
    expect(res.headers['set-cookie']?.[0]).toMatch(/fg_session=.+; .*HttpOnly/i);
    const me = await agent.get('/auth/me').expect(200);
    expect(me.body).toMatchObject({
      user: { email: 'ada@example.com', name: 'Ada' },
      organizations: [
        { id: res.body.orgId, name: 'Acme', roles: ['admin', 'approver', 'employee'] },
      ],
    });
  });

  it('rejects a duplicate email (case-insensitive) and invalid input', async () => {
    await t.agent().post('/auth/signup').send(signup).expect(201);
    const dup = await t
      .agent()
      .post('/auth/signup')
      .send({ ...signup, email: 'ada@EXAMPLE.com' })
      .expect(409);
    expect(dup.body).toEqual({ error: { code: 'EMAIL_TAKEN', message: expect.any(String) } });
    const bad = await t
      .agent()
      .post('/auth/signup')
      .send({ ...signup, password: 'short' })
      .expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('logs in with the right password only', async () => {
    await t.agent().post('/auth/signup').send(signup).expect(201);
    await t
      .agent()
      .post('/auth/login')
      .send({ email: 'ada@example.com', password: 'password123' })
      .expect(200);
    const wrong = await t
      .agent()
      .post('/auth/login')
      .send({ email: 'ada@example.com', password: 'nope-nope' })
      .expect(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    await t
      .agent()
      .post('/auth/login')
      .send({ email: 'ghost@example.com', password: 'whatever1' })
      .expect(401);
  });

  it('requires a session for protected routes, and logout ends it', async () => {
    await t.agent().get('/auth/me').expect(401);
    const agent = t.agent();
    await agent.post('/auth/signup').send(signup).expect(201);
    await agent.post('/auth/logout').expect(204);
    await agent.get('/auth/me').expect(401);
  });

  it('reports health', async () => {
    await t.agent().get('/health').expect(200, { status: 'ok' });
  });
});

describe('Organizations, members and invites', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetDb(t.db);
    t.effects.reset();
  });

  it('invites by email; the invitee creates an account and joins with the given roles', async () => {
    const world = await createOrg(t);
    const invite = await world.admin.agent
      .post(`/orgs/${world.orgId}/invites`)
      .send({ email: 'new@test.dev', roles: ['approver'] })
      .expect(201);
    expect(t.effects.emails).toEqual([
      expect.objectContaining({ template: 'invite', toEmail: 'new@test.dev' }),
    ]);

    const token = String(invite.body.link).split('/invite/')[1];
    const preview = await t.agent().get(`/invites/${token}`).expect(200);
    expect(preview.body).toEqual({ orgName: 'Acme', email: 'new@test.dev', accountExists: false });

    const agent = t.agent();
    await agent
      .post(`/invites/${token}/accept`)
      .send({ name: 'Nina', password: 'password123' })
      .expect(201);
    const me = await agent.get('/auth/me').expect(200);
    expect(me.body.organizations).toEqual([
      expect.objectContaining({ id: world.orgId, roles: ['approver'] }),
    ]);
    // The link works only once.
    const again = await t
      .agent()
      .post(`/invites/${token}/accept`)
      .send({ name: 'X', password: 'password123' })
      .expect(410);
    expect(again.body.error.code).toBe('INVITE_USED');
  });

  it('lets an existing account join another organization with its own password', async () => {
    const first = await createOrg(t, 'First');
    const second = await createOrg(t, 'Second');
    const member = await addMember(t, first, 'Mo');
    const me = await member.agent.get('/auth/me').expect(200);
    const invite = await second.admin.agent
      .post(`/orgs/${second.orgId}/invites`)
      .send({ email: me.body.user.email, roles: ['employee'] })
      .expect(201);
    const token = String(invite.body.link).split('/invite/')[1];
    await t
      .agent()
      .post(`/invites/${token}/accept`)
      .send({ password: 'wrong-password' })
      .expect(401);
    await t.agent().post(`/invites/${token}/accept`).send({ password: 'password123' }).expect(201);
    expect((await member.agent.get('/auth/me').expect(200)).body.organizations).toHaveLength(2);
  });

  it('rejects unknown, revoked and expired invite links', async () => {
    const world = await createOrg(t);
    await t.agent().get('/invites/not-a-real-token').expect(404);

    const revoked = await world.admin.agent
      .post(`/orgs/${world.orgId}/invites`)
      .send({ email: 'r@test.dev', roles: ['employee'] })
      .expect(201);
    await world.admin.agent.delete(`/orgs/${world.orgId}/invites/${revoked.body.id}`).expect(204);
    await t
      .agent()
      .get(`/invites/${String(revoked.body.link).split('/invite/')[1]}`)
      .expect(404);

    const expiring = await world.admin.agent
      .post(`/orgs/${world.orgId}/invites`)
      .send({ email: 'e@test.dev', roles: ['employee'] })
      .expect(201);
    t.clock.advanceHours(24 * 8);
    const res = await t
      .agent()
      .get(`/invites/${String(expiring.body.link).split('/invite/')[1]}`)
      .expect(410);
    expect(res.body.error.code).toBe('INVITE_EXPIRED');
    t.clock.current = new Date();
  });

  it('refuses to invite someone who is already a member', async () => {
    const world = await createOrg(t);
    const me = await world.admin.agent.get('/auth/me').expect(200);
    const res = await world.admin.agent
      .post(`/orgs/${world.orgId}/invites`)
      .send({ email: me.body.user.email, roles: ['employee'] })
      .expect(409);
    expect(res.body.error.code).toBe('ALREADY_MEMBER');
  });

  it('only admins manage members and invites', async () => {
    const world = await createOrg(t);
    const employee = await addMember(t, world, 'Eve');
    await employee.agent.get(`/orgs/${world.orgId}/members`).expect(403);
    await employee.agent
      .post(`/orgs/${world.orgId}/invites`)
      .send({ email: 'x@test.dev', roles: ['employee'] })
      .expect(403);
    await employee.agent.get(`/orgs/${world.orgId}`).expect(200);
    const members = await world.admin.agent.get(`/orgs/${world.orgId}/members`).expect(200);
    expect(members.body.map((m: { name: string }) => m.name)).toEqual(['Ada Admin', 'Eve']);
    const invites = await world.admin.agent.get(`/orgs/${world.orgId}/invites`).expect(200);
    expect(invites.body).toEqual([]);
  });

  it('hides other organizations completely (404, not 403)', async () => {
    const mine = await createOrg(t, 'Mine');
    const theirs = await createOrg(t, 'Theirs');
    const wf = await publishWorkflow(
      theirs,
      chain([node.approval('a', { kind: 'role', role: 'admin' })]),
    );
    const employee = await addMember(t, theirs, 'Tom');
    const requestId = await submit(theirs, employee, wf);

    const outsider = mine.admin.agent;
    await outsider.get(`/orgs/${theirs.orgId}`).expect(404);
    await outsider.get(`/orgs/${theirs.orgId}/workflows`).expect(404);
    await outsider.get(`/orgs/${theirs.orgId}/requests/${requestId}`).expect(404);
    // Using their request id under my own organization doesn't work either.
    await outsider.get(`/orgs/${mine.orgId}/requests/${requestId}`).expect(404);
    await outsider.get(`/orgs/not-a-uuid/requests`).expect(404);
  });

  describe('updating members', () => {
    it('sets roles and managers, and blocks manager loops and self-management', async () => {
      const world = await createOrg(t);
      const a = await addMember(t, world, 'Ann');
      const b = await addMember(t, world, 'Ben');
      await world.admin.agent
        .patch(`/orgs/${world.orgId}/members/${a.id}`)
        .send({ managerId: b.id, roles: ['approver', 'employee'] })
        .expect(200);
      const loop = await world.admin.agent
        .patch(`/orgs/${world.orgId}/members/${b.id}`)
        .send({ managerId: a.id })
        .expect(422);
      expect(loop.body.error.code).toBe('INVALID_MANAGER');
      await world.admin.agent
        .patch(`/orgs/${world.orgId}/members/${a.id}`)
        .send({ managerId: a.id })
        .expect(422);
      await world.admin.agent.patch(`/orgs/${world.orgId}/members/${a.id}`).send({}).expect(400);
    });

    it('never leaves the organization without an admin', async () => {
      const world = await createOrg(t);
      const demote = await world.admin.agent
        .patch(`/orgs/${world.orgId}/members/${world.admin.id}`)
        .send({ roles: ['employee'] })
        .expect(409);
      expect(demote.body.error.code).toBe('LAST_ADMIN');
      await world.admin.agent.delete(`/orgs/${world.orgId}/members/${world.admin.id}`).expect(409);
    });

    it('removing a member hands their open tasks to someone else', async () => {
      const world = await createOrg(t);
      const manager = await addMember(t, world, 'Maria', ['approver']);
      const employee = await addMember(t, world, 'Emma', ['employee'], manager.id);
      const wf = await publishWorkflow(world, chain([node.approval('mgr', { kind: 'manager' })]));
      const id = await submit(world, employee, wf);

      await world.admin.agent.delete(`/orgs/${world.orgId}/members/${manager.id}`).expect(204);
      const detail = await getRequest(world, employee, id);
      expect(detail.tasks.map((task) => [task.assignee.id, task.status])).toEqual(
        expect.arrayContaining([
          [manager.id, 'escalated'],
          [world.admin.id, 'pending'],
        ]),
      );
      expect(detail.tasks).toHaveLength(2);
      await manager.agent.get(`/orgs/${world.orgId}`).expect(404);
      const members = await world.admin.agent.get(`/orgs/${world.orgId}/members`).expect(200);
      expect(
        members.body.find((m: { userId: string }) => m.userId === employee.id).managerId,
      ).toBeNull();
    });
  });
});
