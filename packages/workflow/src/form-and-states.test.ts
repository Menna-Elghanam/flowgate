import type { FormDefinition } from './definition';
import { buildFormDataSchema } from './form';
import {
  assertRequestTransition,
  assertTaskTransition,
  canMoveRequest,
  InvalidTransitionError,
  REQUEST_STATUSES,
} from './states';

describe('buildFormDataSchema', () => {
  const form: FormDefinition = {
    fields: [
      { id: 'cost', label: 'Cost', type: 'number', required: true },
      { id: 'needed_by', label: 'Needed by', type: 'date', required: false },
      { id: 'kind', label: 'Kind', type: 'select', required: true, options: ['Laptop', 'Monitor'] },
      { id: 'note', label: 'Note', type: 'text', required: false },
    ],
  };
  const schema = buildFormDataSchema(form);

  it('accepts valid answers, turns empty optional answers into null and drops unknown keys', () => {
    expect(schema.parse({ cost: 900, kind: 'Laptop', note: '', extra: 'x' })).toEqual({
      cost: 900,
      needed_by: null,
      kind: 'Laptop',
      note: null,
    });
  });

  it('rejects missing required answers, wrong types, unknown options and impossible dates', () => {
    expect(schema.safeParse({ kind: 'Laptop' }).success).toBe(false);
    expect(schema.safeParse({ cost: '900', kind: 'Laptop' }).success).toBe(false);
    expect(schema.safeParse({ cost: 1, kind: 'Phone' }).success).toBe(false);
    expect(schema.safeParse({ cost: 1, kind: 'Laptop', needed_by: '2026-02-30' }).success).toBe(
      false,
    );
  });
});

describe('state machines', () => {
  it('lets a request move only along defined transitions', () => {
    expect(canMoveRequest('in_progress', 'approved')).toBe(true);
    expect(canMoveRequest('changes_requested', 'in_progress')).toBe(true);
    expect(canMoveRequest('changes_requested', 'approved')).toBe(false);
  });

  it('treats approved, rejected and cancelled as final', () => {
    for (const from of ['approved', 'rejected', 'cancelled'] as const) {
      for (const to of REQUEST_STATUSES) {
        expect(() => assertRequestTransition(from, to)).toThrow(InvalidTransitionError);
      }
    }
  });

  it('lets a task be decided only once', () => {
    expect(() => assertTaskTransition('pending', 'approved')).not.toThrow();
    expect(() => assertTaskTransition('approved', 'rejected')).toThrow(InvalidTransitionError);
  });
});
