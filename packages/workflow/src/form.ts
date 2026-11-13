import { z } from 'zod';
import type { FormDefinition, FormField } from './definition';

export type FormValue = string | number | null;
export type FormData = Record<string, FormValue>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** Empty inputs from HTML forms arrive as '' — treat them as "no answer". */
const emptyToNull = (value: unknown) => (value === '' || value === undefined ? null : value);

function fieldValueSchema(field: FormField): z.ZodType<FormValue> {
  let base: z.ZodType<string | number>;
  switch (field.type) {
    case 'text':
      base = z.string().trim().min(1).max(200);
      break;
    case 'textarea':
      base = z.string().trim().min(1).max(5000);
      break;
    case 'number':
      base = z.number().finite();
      break;
    case 'date':
      base = z.string().refine(isRealDate, 'Expected a date (YYYY-MM-DD)');
      break;
    case 'select': {
      const options = field.options ?? [];
      base = z
        .string()
        .refine((value) => options.includes(value), 'Pick one of the listed options');
      break;
    }
  }
  const valueSchema = field.required ? base : base.nullable();
  return z.preprocess(emptyToNull, valueSchema) as z.ZodType<FormValue>;
}

/**
 * Builds a Zod schema for the answers to a form. Unknown keys are dropped and missing
 * optional answers become `null`, so stored data always has one key per field.
 */
export function buildFormDataSchema(form: FormDefinition): z.ZodType<FormData> {
  const shape: Record<string, z.ZodType<FormValue>> = {};
  for (const field of form.fields) shape[field.id] = fieldValueSchema(field);
  return z.object(shape) as unknown as z.ZodType<FormData>;
}
