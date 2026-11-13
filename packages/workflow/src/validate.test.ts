import { starterDefinition, type WorkflowDefinition } from './definition';
import { approval, edge, laptopWorkflow } from './fixtures.test-helpers';
import { validateDefinition, type IssueCode } from './validate';

const codes = (definition: unknown): IssueCode[] =>
  validateDefinition(definition).map((i) => i.code);
const at = { x: 0, y: 0 };

describe('validateDefinition', () => {
  it('accepts the starter definition and a branching workflow', () => {
    expect(validateDefinition(starterDefinition())).toEqual([]);
    expect(validateDefinition(laptopWorkflow())).toEqual([]);
  });

  it('reports shape errors instead of throwing on garbage input', () => {
    expect(codes({ nodes: 'nope' })).toContain('INVALID_SHAPE');
    expect(codes(null)).toContain('INVALID_SHAPE');
  });

  it('requires exactly one start and at least one end', () => {
    const def = laptopWorkflow();
    def.nodes = def.nodes.filter((n) => n.type !== 'start');
    def.edges = def.edges.filter((e) => e.source !== 'start');
    expect(codes(def)).toContain('MISSING_START');

    const twoStarts = laptopWorkflow();
    twoStarts.nodes.push({ id: 'start2', type: 'start', position: at });
    twoStarts.edges.push(edge('e9', 'start2', 'manager'));
    expect(codes(twoStarts)).toContain('MULTIPLE_STARTS');

    const noEnd: WorkflowDefinition = {
      form: { fields: [] },
      nodes: [{ id: 's', type: 'start', position: at }, approval('a')],
      edges: [edge('e1', 's', 'a')],
    };
    expect(codes(noEnd)).toEqual(expect.arrayContaining(['MISSING_END', 'WRONG_OUTGOING_COUNT']));
  });

  it('rejects duplicate ids and arrows to missing steps', () => {
    const def = laptopWorkflow();
    def.nodes.push(approval('manager'));
    expect(codes(def)).toContain('DUPLICATE_NODE_ID');

    const dangling = laptopWorkflow();
    dangling.edges.push(edge('e9', 'finance', 'ghost'));
    expect(codes(dangling)).toEqual(['EDGE_UNKNOWN_NODE']);
  });

  it('requires one arrow out of start and approvals, none out of ends', () => {
    const def = laptopWorkflow();
    def.edges.push(edge('e9', 'manager', 'done'));
    def.edges.push(edge('e10', 'done', 'finance'));
    const found = codes(def);
    expect(found).toContain('WRONG_OUTGOING_COUNT');
    expect(found).toContain('END_HAS_OUTGOING');
  });

  it('requires a single default path and valid rules on condition arrows', () => {
    const noDefault = laptopWorkflow();
    noDefault.edges = noDefault.edges.map((e) => (e.id === 'e4' ? { ...e, isDefault: false } : e));
    expect(codes(noDefault)).toEqual(expect.arrayContaining(['CONDITION_DEFAULT', 'MISSING_RULE']));

    const badRule = laptopWorkflow();
    badRule.edges = badRule.edges.map((e) =>
      e.id === 'e3' ? { ...e, rule: { field: 'cost', operator: 'gt', value: 'lots' } } : e,
    );
    expect(codes(badRule)).toContain('RULE_INVALID');

    const unknownField = laptopWorkflow();
    unknownField.edges = unknownField.edges.map((e) =>
      e.id === 'e3' ? { ...e, rule: { field: 'price', operator: 'gt', value: 1 } } : e,
    );
    expect(codes(unknownField)).toContain('RULE_UNKNOWN_FIELD');

    const textGreaterThan = laptopWorkflow();
    textGreaterThan.edges = textGreaterThan.edges.map((e) =>
      e.id === 'e3' ? { ...e, rule: { field: 'reason', operator: 'gt', value: 'a' } } : e,
    );
    expect(codes(textGreaterThan)).toContain('RULE_INVALID');
  });

  it('only allows rules on arrows leaving a condition', () => {
    const def = laptopWorkflow();
    def.edges = def.edges.map((e) => (e.id === 'e1' ? { ...e, isDefault: true } : e));
    expect(codes(def)).toContain('RULE_NOT_ALLOWED');
  });

  it('rejects loops', () => {
    const def = laptopWorkflow();
    def.edges = def.edges.map((e) => (e.id === 'e5' ? { ...e, target: 'manager' } : e));
    expect(codes(def)).toContain('CYCLE');
  });

  it('reports steps that cannot be reached from start', () => {
    const def = laptopWorkflow();
    def.nodes.push(approval('orphan'));
    def.edges.push(edge('e9', 'orphan', 'done'));
    expect(validateDefinition(def)).toEqual([
      expect.objectContaining({ code: 'UNREACHABLE_NODE', nodeId: 'orphan' }),
    ]);
  });

  it('forbids any path that ends approved without an approval step', () => {
    const def = laptopWorkflow();
    // Small purchases skip the manager entirely: start → condition → approved.
    def.edges = [
      edge('e1', 'start', 'check_cost'),
      edge('e3', 'check_cost', 'manager', { rule: { field: 'cost', operator: 'gt', value: 1000 } }),
      edge('e4', 'check_cost', 'done', { isDefault: true }),
      edge('e2', 'manager', 'finance'),
      edge('e5', 'finance', 'done'),
    ];
    expect(codes(def)).toEqual(['APPROVED_WITHOUT_APPROVAL']);
  });

  it('allows a path straight to a rejected end (automatic rejection)', () => {
    const def = laptopWorkflow();
    def.nodes.push({ id: 'too_expensive', type: 'end', position: at, outcome: 'rejected' });
    def.edges = [
      edge('e1', 'start', 'check_cost'),
      edge('e3', 'check_cost', 'too_expensive', {
        rule: { field: 'cost', operator: 'gt', value: 5000 },
      }),
      edge('e4', 'check_cost', 'manager', { isDefault: true }),
      edge('e2', 'manager', 'finance'),
      edge('e5', 'finance', 'done'),
    ];
    expect(validateDefinition(def)).toEqual([]);
  });

  it('checks the form: unique keys and options for dropdowns', () => {
    const def = laptopWorkflow();
    def.form.fields.push({ id: 'cost', label: 'Cost again', type: 'number', required: false });
    def.form.fields.push({
      id: 'kind',
      label: 'Kind',
      type: 'select',
      required: true,
      options: [],
    });
    expect(codes(def)).toEqual(
      expect.arrayContaining(['DUPLICATE_FIELD_ID', 'SELECT_WITHOUT_OPTIONS']),
    );
  });
});
