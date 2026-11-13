import { starterDefinition } from '@flowgate/workflow';
import {
  addMember,
  chain,
  createOrg,
  createTestApp,
  node,
  resetDb,
  type TestApp,
  type World,
} from './helpers';

describe('Workflows', () => {
  let t: TestApp;
  let world: World;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetDb(t.db);
    world = await createOrg(t);
  });

  const base = () => `/orgs/${world.orgId}/workflows`;

  it('creates a workflow with a starter draft (version 1)', async () => {
    const res = await world.admin.agent.post(base()).send({ name: 'Laptop request' }).expect(201);
    expect(res.body).toMatchObject({
      name: 'Laptop request',
      draft: { version: 1, definition: starterDefinition() },
      published: null,
      issues: [],
    });
    const list = await world.admin.agent.get(base()).expect(200);
    expect(list.body).toEqual([
      expect.objectContaining({
        name: 'Laptop request',
        publishedVersion: null,
        hasDraft: true,
        openRequests: 0,
      }),
    ]);
  });

  it('rejects duplicate names and invalid input', async () => {
    await world.admin.agent.post(base()).send({ name: 'Same' }).expect(201);
    await world.admin.agent.post(base()).send({ name: 'Same' }).expect(409);
    await world.admin.agent.post(base()).send({ name: '' }).expect(400);
  });

  it('saves unfinished drafts but reports their problems', async () => {
    const { body } = await world.admin.agent.post(base()).send({ name: 'WF' }).expect(201);
    const broken = { form: { fields: [] }, nodes: [node.start()], edges: [] };
    const res = await world.admin.agent
      .put(`${base()}/${body.id}/draft`)
      .send({ definition: broken })
      .expect(200);
    expect(res.body.issues.map((i: { code: string }) => i.code)).toEqual(
      expect.arrayContaining(['MISSING_END', 'WRONG_OUTGOING_COUNT']),
    );

    const shape = await world.admin.agent
      .put(`${base()}/${body.id}/draft`)
      .send({ definition: { nodes: 'nope' } })
      .expect(400);
    expect(shape.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('refuses to publish an invalid workflow and lists every problem', async () => {
    const { body } = await world.admin.agent.post(base()).send({ name: 'WF' }).expect(201);
    await world.admin.agent
      .put(`${base()}/${body.id}/draft`)
      .send({ definition: { form: { fields: [] }, nodes: [node.start(), node.end()], edges: [] } })
      .expect(200);
    const res = await world.admin.agent.post(`${base()}/${body.id}/publish`).expect(422);
    expect(res.body.error.code).toBe('WORKFLOW_INVALID');
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  it('refuses to publish steps assigned to people outside the organization', async () => {
    const { body } = await world.admin.agent.post(base()).send({ name: 'WF' }).expect(201);
    const stranger = '00000000-0000-4000-8000-000000000000';
    await world.admin.agent
      .put(`${base()}/${body.id}/draft`)
      .send({ definition: chain([node.approval('x', { kind: 'users', userIds: [stranger] })]) })
      .expect(200);
    const res = await world.admin.agent.post(`${base()}/${body.id}/publish`).expect(422);
    expect(res.body.error.details).toEqual([
      expect.objectContaining({ code: 'UNKNOWN_USER', nodeId: 'x' }),
    ]);
  });

  it('publishes, then editing creates version 2 while version 1 stays current', async () => {
    const { body } = await world.admin.agent.post(base()).send({ name: 'WF' }).expect(201);
    const published = await world.admin.agent.post(`${base()}/${body.id}/publish`).expect(201);
    expect(published.body).toMatchObject({
      publishedNow: 1,
      draft: null,
      published: { version: 1 },
    });
    await world.admin.agent.post(`${base()}/${body.id}/publish`).expect(409);

    const edited = chain([node.approval('a', { kind: 'role', role: 'admin' })]);
    const saved = await world.admin.agent
      .put(`${base()}/${body.id}/draft`)
      .send({ definition: edited })
      .expect(200);
    expect(saved.body.draft.version).toBe(2);

    const detail = await world.admin.agent.get(`${base()}/${body.id}`).expect(200);
    expect(
      detail.body.versions.map((v: { version: number; status: string; isCurrent: boolean }) => [
        v.version,
        v.status,
        v.isCurrent,
      ]),
    ).toEqual([
      [2, 'draft', false],
      [1, 'published', true],
    ]);

    // Discarding the draft goes back to just version 1.
    const discarded = await world.admin.agent.delete(`${base()}/${body.id}/draft`).expect(200);
    expect(discarded.body.draft).toBeNull();
  });

  it("can't discard the only version", async () => {
    const { body } = await world.admin.agent.post(base()).send({ name: 'WF' }).expect(201);
    const res = await world.admin.agent.delete(`${base()}/${body.id}/draft`).expect(409);
    expect(res.body.error.code).toBe('ONLY_VERSION');
  });

  it('renames a workflow', async () => {
    const { body } = await world.admin.agent.post(base()).send({ name: 'WF' }).expect(201);
    const res = await world.admin.agent
      .patch(`${base()}/${body.id}`)
      .send({ name: 'Renamed', description: 'Hi' })
      .expect(200);
    expect(res.body).toMatchObject({ name: 'Renamed', description: 'Hi' });
    await world.admin.agent
      .patch(`${base()}/00000000-0000-4000-8000-000000000000`)
      .send({ name: 'X' })
      .expect(404);
  });

  it('employees see only published workflows with their forms, and cannot manage workflows', async () => {
    const employee = await addMember(t, world, 'Eve');
    const { body } = await world.admin.agent.post(base()).send({ name: 'Visible' }).expect(201);
    await world.admin.agent.post(base()).send({ name: 'Hidden draft' }).expect(201);
    await world.admin.agent.post(`${base()}/${body.id}/publish`).expect(201);

    const available = await employee.agent.get(`${base()}/available`).expect(200);
    expect(available.body).toEqual([
      expect.objectContaining({ name: 'Visible', version: 1, form: starterDefinition().form }),
    ]);
    await employee.agent.get(base()).expect(403);
    await employee.agent.post(base()).send({ name: 'Nope' }).expect(403);
    await employee.agent.get(`${base()}/${body.id}`).expect(403);
    await employee.agent.post(`${base()}/${body.id}/publish`).expect(403);
  });
});
