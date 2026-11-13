'use client';

import type { FormData, FormDefinition, FormField } from '@flowgate/workflow';
import { useState, type FormEvent, type ReactNode } from 'react';
import { fieldErrors, errorMessage } from '@/lib/api';
import { Button, Field, FormError, Input, Select, Textarea } from './ui';

/** HTML inputs only hold strings; this keeps them as typed in until the form is sent. */
type Draft = Record<string, string>;

function toDraft(form: FormDefinition, data?: FormData): Draft {
  const draft: Draft = {};
  for (const field of form.fields) {
    const value = data?.[field.id];
    draft[field.id] = value === null || value === undefined ? '' : String(value);
  }
  return draft;
}

/** Numbers are sent as numbers; everything else as text. The API validates the rest. */
function toData(form: FormDefinition, draft: Draft): FormData {
  const data: FormData = {};
  for (const field of form.fields) {
    const raw = draft[field.id]?.trim() ?? '';
    if (raw === '') data[field.id] = null;
    else if (field.type === 'number')
      data[field.id] = Number.isFinite(Number(raw)) ? Number(raw) : raw;
    else data[field.id] = raw;
  }
  return data;
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: string;
  onChange: (v: string) => void;
}) {
  const common = { id: `field-${field.id}`, required: field.required, value };
  switch (field.type) {
    case 'textarea':
      return <Textarea {...common} onChange={(e) => onChange(e.target.value)} />;
    case 'select':
      return (
        <Select {...common} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      );
    case 'number':
      return (
        <Input
          {...common}
          type="number"
          inputMode="decimal"
          step="any"
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'date':
      return <Input {...common} type="date" onChange={(e) => onChange(e.target.value)} />;
    case 'text':
      return <Input {...common} type="text" onChange={(e) => onChange(e.target.value)} />;
  }
}

/**
 * Renders a workflow's request form. Used to submit a new request and to resubmit one
 * that was sent back, so both show the same inputs and the same error messages.
 */
export function RequestForm({
  form,
  initialTitle = '',
  initialData,
  submitLabel,
  onSubmit,
  extraActions,
}: {
  form: FormDefinition;
  initialTitle?: string;
  initialData?: FormData;
  submitLabel: string;
  onSubmit: (input: { title: string; data: FormData }) => Promise<void>;
  extraActions?: ReactNode;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [draft, setDraft] = useState<Draft>(() => toDraft(form, initialData));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      await onSubmit({ title: title.trim(), data: toData(form, draft) });
    } catch (err) {
      setErrors(fieldErrors(err));
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <Field
        label="Title"
        htmlFor="request-title"
        hint="A short summary, e.g. “New laptop for Sara”"
        error={errors.title}
      >
        <Input
          id="request-title"
          required
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>
      {form.fields.map((field) => (
        <Field
          key={field.id}
          label={field.required ? field.label : `${field.label} (optional)`}
          htmlFor={`field-${field.id}`}
          hint={field.helpText}
          error={errors[field.id]}
        >
          <FieldInput
            field={field}
            value={draft[field.id] ?? ''}
            onChange={(value) => setDraft((d) => ({ ...d, [field.id]: value }))}
          />
        </Field>
      ))}
      <FormError message={formError} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" busy={busy}>
          {submitLabel}
        </Button>
        {extraActions}
      </div>
    </form>
  );
}
