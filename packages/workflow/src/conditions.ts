import type { FieldType, FormField, Operator, Rule } from './definition';
import type { FormValue } from './form';

/** Which operators make sense for each field type. Dates compare as ISO strings. */
export const OPERATORS_BY_FIELD_TYPE: Record<FieldType, readonly Operator[]> = {
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  date: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  select: ['eq', 'neq'],
  text: ['eq', 'neq'],
  textarea: [],
};

export const OPERATOR_LABELS: Record<Operator, string> = {
  eq: '=',
  neq: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
};

/** Returns a problem description, or null when the rule fits the field. */
export function checkRuleAgainstField(rule: Rule, field: FormField): string | null {
  const allowed = OPERATORS_BY_FIELD_TYPE[field.type];
  if (!allowed.includes(rule.operator)) {
    return `Operator "${OPERATOR_LABELS[rule.operator]}" can't be used with ${field.type} field "${field.label}"`;
  }
  if (field.type === 'number' && typeof rule.value !== 'number') {
    return `"${field.label}" is a number field, so the value must be a number`;
  }
  if (field.type !== 'number' && typeof rule.value !== 'string') {
    return `"${field.label}" needs a text value`;
  }
  if (field.type === 'select' && !(field.options ?? []).includes(String(rule.value))) {
    return `"${String(rule.value)}" is not an option of "${field.label}"`;
  }
  if (field.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(rule.value))) {
    return `"${field.label}" needs a date value (YYYY-MM-DD)`;
  }
  return null;
}

/** An unanswered optional field never matches a rule, so the default path is taken. */
export function evaluateRule(rule: Rule, value: FormValue | undefined): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value !== typeof rule.value) return false;
  const left = value;
  const right = rule.value;
  switch (rule.operator) {
    case 'eq':
      return left === right;
    case 'neq':
      return left !== right;
    case 'gt':
      return left > right;
    case 'gte':
      return left >= right;
    case 'lt':
      return left < right;
    case 'lte':
      return left <= right;
  }
}
