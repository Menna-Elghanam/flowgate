import { evaluateRule } from './conditions';
import { laptopWorkflow } from './fixtures.test-helpers';
import { nextStop, RoutingError, startNodeId } from './routing';

describe('nextStop', () => {
  const def = laptopWorkflow();

  it('goes from start to the first approval', () => {
    const stop = nextStop(def, startNodeId(def), { cost: 500, reason: null });
    expect(stop).toMatchObject({ kind: 'approval', node: { id: 'manager' } });
  });

  it('passes through a condition to finance when the rule matches', () => {
    expect(nextStop(def, 'manager', { cost: 1500, reason: null })).toMatchObject({
      kind: 'approval',
      node: { id: 'finance' },
    });
  });

  it('takes the default path when no rule matches', () => {
    expect(nextStop(def, 'manager', { cost: 1000, reason: null })).toMatchObject({
      kind: 'end',
      node: { id: 'done', outcome: 'approved' },
    });
  });

  it('takes the default path when the field was left empty', () => {
    expect(nextStop(def, 'manager', { cost: null, reason: null })).toMatchObject({ kind: 'end' });
  });

  it('throws for an unknown step', () => {
    expect(() => nextStop(def, 'nope', {})).toThrow(RoutingError);
  });
});

describe('evaluateRule', () => {
  it.each([
    ['eq', 5, 5, true],
    ['neq', 5, 5, false],
    ['gt', 6, 5, true],
    ['gte', 5, 5, true],
    ['lt', 4, 5, true],
    ['lte', 6, 5, false],
  ] as const)('%s: %p vs %p → %p', (operator, value, ruleValue, expected) => {
    expect(evaluateRule({ field: 'f', operator, value: ruleValue }, value)).toBe(expected);
  });

  it('compares ISO dates as strings', () => {
    expect(evaluateRule({ field: 'd', operator: 'gt', value: '2026-01-01' }, '2026-02-01')).toBe(
      true,
    );
  });

  it('never matches a value of a different type', () => {
    expect(evaluateRule({ field: 'f', operator: 'eq', value: 5 }, '5')).toBe(false);
  });
});
