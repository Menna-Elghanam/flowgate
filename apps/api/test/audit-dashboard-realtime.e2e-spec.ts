import type { AddressInfo } from 'node:net';
import type { Redis } from 'ioredis';
import { io, type Socket } from 'socket.io-client';
import { REALTIME_CHANNEL, REDIS } from '../src/core/queue/queue.module';
import {
  addMember,
  chain,
  createOrg,
  createTestApp,
  decide,
  node,
  publishWorkflow,
  resetDb,
  submit,
  type Person,
  type TestApp,
  type World,
} from './helpers';

describe('Audit log, dashboard and live updates', () => {
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
    world = await createOrg(t);
    manager = await addMember(t, world, 'Maria Manager', ['approver']);
    employee = await addMember(t, world, 'Emma Employee', ['employee'], manager.id);
  });

  it('lists audit events newest first with cursor paging (admins only)', async () => {
    const wf = await publishWorkflow(
      world,
      chain([node.approval('mgr', { kind: 'manager' })]),
      'Laptop',
    );
    const id = await submit(world, employee, wf);
    await decide(world, manager, id);

    const first = await world.admin.agent.get(`/orgs/${world.orgId}/audit?limit=3`).expect(200);
    expect(first.body.events.map((e: { action: string }) => e.action)).toEqual([
      'request_approved',
      'step_completed',
      'task_approved',
    ]);
    expect(first.body.events[2]).toMatchObject({
      actorName: 'Maria Manager',
      requestTitle: 'Test request',
    });
    const next = await world.admin.agent
      .get(`/orgs/${world.orgId}/audit?limit=3&before=${first.body.nextCursor}`)
      .expect(200);
    expect(next.body.events[0].action).toBe('step_started');

    const forRequest = await world.admin.agent
      .get(`/orgs/${world.orgId}/audit?requestId=${id}&limit=200`)
      .expect(200);
    expect(forRequest.body).toMatchObject({ nextCursor: null });
    expect(forRequest.body.events).toHaveLength(5);

    await employee.agent.get(`/orgs/${world.orgId}/audit`).expect(403);
  });

  it('exports the audit log as CSV', async () => {
    const wf = await publishWorkflow(
      world,
      chain([node.approval('mgr', { kind: 'manager' })]),
      'Laptop',
    );
    await employee.agent
      .post(`/orgs/${world.orgId}/requests`)
      .send({ workflowId: wf, title: '=HYPERLINK("http://evil")', data: {} })
      .expect(201);
    const res = await world.admin.agent.get(`/orgs/${world.orgId}/audit/export.csv`).expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toBe('id,time,action,actor,request,workflow,from,to,step,details');
    // The formula is neutralised so a spreadsheet shows it as text.
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    await employee.agent.get(`/orgs/${world.orgId}/audit/export.csv`).expect(403);
  });

  it('summarises workflows and slow steps on the dashboard', async () => {
    const wf = await publishWorkflow(
      world,
      chain([
        node.approval('mgr', { kind: 'manager' }, { name: 'Manager approval', dueInHours: 4 }),
      ]),
      'Laptop',
    );
    const done = await submit(world, employee, wf);
    t.clock.advanceHours(3);
    await decide(world, manager, done);
    await submit(world, employee, wf);
    t.clock.advanceHours(5); // the second request's task is now overdue

    const res = await world.admin.agent.get(`/orgs/${world.orgId}/dashboard`).expect(200);
    expect(res.body.totals).toEqual({
      openRequests: 1,
      openTasks: 1,
      overdueTasks: 1,
      finishedLast30Days: 1,
    });
    expect(res.body.workflows).toEqual([
      expect.objectContaining({
        name: 'Laptop',
        total: 2,
        open: 1,
        approved: 1,
        avgHoursToFinish: 3,
      }),
    ]);
    expect(res.body.slowestSteps).toEqual([
      { workflowName: 'Laptop', stepName: 'Manager approval', decisions: 1, avgHoursToDecide: 3 },
    ]);
    await employee.agent.get(`/orgs/${world.orgId}/dashboard`).expect(403);
    t.clock.current = new Date();
  });

  describe('WebSocket gateway', () => {
    let url: string;
    const sockets: Socket[] = [];

    beforeAll(async () => {
      await t.app.listen(0);
      url = `http://127.0.0.1:${(t.app.getHttpServer().address() as AddressInfo).port}`;
    });
    afterEach(() => sockets.splice(0).forEach((s) => s.close()));

    const connect = (cookie?: string) => {
      const socket = io(url, {
        transports: ['websocket'],
        extraHeaders: cookie ? { cookie } : {},
        reconnection: false,
      });
      sockets.push(socket);
      return socket;
    };

    it('pushes change notices to the right user only', async () => {
      const login = await t.agent().post('/auth/signup').send({
        name: 'Sock',
        email: 'sock@test.dev',
        password: 'password123',
        organizationName: 'S',
      });
      const cookie = String(login.headers['set-cookie']?.[0]).split(';')[0];
      const socket = connect(cookie);
      await new Promise<void>((resolve) => socket.on('connect', resolve));
      await new Promise((resolve) => setTimeout(resolve, 100)); // let the server finish joining the room

      const received = new Promise((resolve) => socket.on('changed', resolve));
      const redis = t.app.get<Redis>(REDIS);
      await redis.publish(
        REALTIME_CHANNEL,
        JSON.stringify({ orgId: 'o1', requestId: 'r1', userIds: ['someone-else'] }),
      );
      await redis.publish(
        REALTIME_CHANNEL,
        JSON.stringify({ orgId: 'o1', requestId: 'r2', userIds: [login.body.user.id] }),
      );
      await expect(received).resolves.toEqual({ orgId: 'o1', requestId: 'r2' });
    });

    it('disconnects sockets without a valid session', async () => {
      const socket = connect('fg_session=forged');
      await new Promise<void>((resolve) => socket.on('disconnect', () => resolve()));
      expect(socket.connected).toBe(false);
    });
  });
});
