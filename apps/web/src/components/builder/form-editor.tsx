'use client';

import {
  FIELD_TYPES,
  type FieldType,
  type FormField,
  type WorkflowDefinition,
} from '@flowgate/workflow';
import { useState } from 'react';
import { addField, moveField, removeField, updateField, type Updater } from '@/lib/builder';
import { Button, Card, Field, Input, Select, Textarea } from '../ui';

const TYPE_LABEL: Record<FieldType, string> = {
  text: 'Short text',
  textarea: 'Long text',
  number: 'Number',
  date: 'Date',
  select: 'Choice list',
};

const parseOptions = (text: string) =>
  text
    .split('\n')
    .map((o) => o.trim())
    .filter(Boolean);

/** Keeps the raw text while typing, so an empty last line isn't trimmed away mid-edit. */
function OptionsEditor({ field, update }: { field: FormField; update: (fn: Updater) => void }) {
  const stored = (field.options ?? []).join('\n');
  const [text, setText] = useState(stored);
  // The options changed from outside (e.g. fields were reordered): show the stored ones.
  if (parseOptions(text).join('\n') !== stored) setText(stored);
  return (
    <Field label="Choices (one per line)" htmlFor={`opts-${field.id}`}>
      <Textarea
        id={`opts-${field.id}`}
        rows={4}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          update(updateField(field.id, { options: parseOptions(e.target.value) }));
        }}
      />
    </Field>
  );
}

function FieldCard({
  field,
  index,
  count,
  update,
}: {
  field: FormField;
  index: number;
  count: number;
  update: (fn: Updater) => void;
}) {
  const set = (patch: Partial<FormField>) => update(updateField(field.id, patch));
  const prefix = `f${index}`;
  return (
    <Card className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Label" htmlFor={`${prefix}-label`}>
          <Input
            id={`${prefix}-label`}
            maxLength={80}
            value={field.label}
            onChange={(e) => set({ label: e.target.value })}
          />
        </Field>
        <Field
          label="Key"
          htmlFor={`${prefix}-id`}
          hint="Used in conditions. Lowercase letters, digits and _."
        >
          <Input
            id={`${prefix}-id`}
            maxLength={40}
            value={field.id}
            onChange={(e) => set({ id: e.target.value })}
          />
        </Field>
        <Field label="Type" htmlFor={`${prefix}-type`}>
          <Select
            id={`${prefix}-type`}
            value={field.type}
            onChange={(e) => set({ type: e.target.value as FieldType })}
          >
            {FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Help text (optional)" htmlFor={`${prefix}-help`}>
          <Input
            id={`${prefix}-help`}
            maxLength={200}
            value={field.helpText ?? ''}
            onChange={(e) => set({ helpText: e.target.value || undefined })}
          />
        </Field>
      </div>
      {field.type === 'select' && <OptionsEditor field={field} update={update} />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={field.required}
            onChange={(e) => set({ required: e.target.checked })}
          />
          Required
        </label>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            disabled={index === 0}
            onClick={() => update(moveField(field.id, -1))}
            aria-label={`Move ${field.label} up`}
          >
            ↑
          </Button>
          <Button
            variant="ghost"
            disabled={index === count - 1}
            onClick={() => update(moveField(field.id, 1))}
            aria-label={`Move ${field.label} down`}
          >
            ↓
          </Button>
          <Button variant="ghost" onClick={() => update(removeField(field.id))}>
            Remove
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function FormEditor({
  definition,
  update,
}: {
  definition: WorkflowDefinition;
  update: (fn: Updater) => void;
}) {
  const { fields } = definition.form;
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        These are the questions employees answer when they submit a request. A title is always
        asked.
      </p>
      {fields.map((field, index) => (
        // Index as key: the field's id is editable, and a changing key would remount the inputs mid-typing.
        <FieldCard key={index} field={field} index={index} count={fields.length} update={update} />
      ))}
      <Button variant="secondary" onClick={() => update(addField)}>
        Add field
      </Button>
    </div>
  );
}
