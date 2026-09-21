'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { networkMessage, REQUEST_TIMEOUT_MS } from '@/lib/network';
import { CreateIntakeSchema, type CreateIntakeInput } from '@/lib/schemas';

type Field = keyof CreateIntakeInput;
type Errors = Partial<Record<Field, string>>;

const EMPTY: CreateIntakeInput = {
  title: '',
  description: '',
  budgetRange: '',
  timeline: '',
  industry: '',
};

export function CreateIntakeForm() {
  const router = useRouter();
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [submitError, setSubmitError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const update = (field: Field) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    // Clearing on edit rather than re-validating: telling someone their title is too short
    // while they are still typing it is nagging, not help.
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitError(undefined);

    const parsed = CreateIntakeSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(firstMessages(parsed.error.flatten().fieldErrors));
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/intakes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        if (body?.fieldErrors) setErrors(firstMessages(body.fieldErrors));
        setSubmitError(body?.error ?? `The server rejected the intake (${response.status}).`);
        setSubmitting(false);
        return;
      }

      // Left disabled because the form stays mounted until the detail page loads, and a second
      // click would post twice: POST /api/intakes has no idempotency key.
      router.push(`/intakes/${body.id}`);
    } catch (err) {
      console.error('[create] could not submit the intake', err);
      setSubmitError(networkMessage(err));
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate className="rounded-lg border border-line bg-card p-8">
      <h1 className="font-serif text-3xl">New intake</h1>

      <div className="mt-6 space-y-5">
        <TextField
          name="title"
          label="Title"
          value={values.title}
          error={errors.title}
          onChange={update('title')}
        />

        <TextField
          name="description"
          label="Description"
          rows={4}
          value={values.description}
          error={errors.description}
          onChange={update('description')}
        />

        <div className="grid gap-5 sm:grid-cols-3">
          <TextField
            name="budgetRange"
            label="Budget range"
            value={values.budgetRange}
            error={errors.budgetRange}
            onChange={update('budgetRange')}
          />
          <TextField
            name="timeline"
            label="Timeline"
            value={values.timeline}
            error={errors.timeline}
            onChange={update('timeline')}
          />
          <TextField
            name="industry"
            label="Industry"
            value={values.industry}
            error={errors.industry}
            onChange={update('industry')}
          />
        </div>
      </div>

      {submitError && (
        <p role="alert" className="mt-6 rounded-md bg-clay px-4 py-3 text-sm text-clay-ink">
          {submitError}
        </p>
      )}

      <div className="mt-8 flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-ink px-5 py-3 text-sm font-semibold text-card transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Creating…' : 'Create intake'}
        </button>
        <Link
          href="/"
          className="rounded-md border border-line px-5 py-3 text-sm font-medium transition-colors hover:border-faint"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

function TextField({
  name,
  label,
  value,
  error,
  rows,
  onChange,
}: {
  name: Field;
  label: string;
  value: string;
  error?: string;
  rows?: number;
  onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
}) {
  const errorId = `${name}-error`;
  const className = `w-full rounded-md border bg-card px-3 py-2.5 text-sm ${
    error ? 'border-clay-ink' : 'border-line'
  }`;
  const shared = {
    id: name,
    name,
    value,
    onChange,
    className,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? errorId : undefined,
  };

  return (
    <div>
      <label htmlFor={name} className="text-sm font-semibold">
        {label}
      </label>
      <div className="mt-1.5">
        {rows ? <textarea rows={rows} {...shared} /> : <input type="text" {...shared} />}
      </div>
      {error && (
        <p id={errorId} className="mt-1.5 text-sm text-clay-ink">
          {error}
        </p>
      )}
    </div>
  );
}

// Zod hands back every failure per field; the first one is the one worth acting on.
function firstMessages(fieldErrors: Partial<Record<string, string[]>>): Errors {
  const errors: Errors = {};
  for (const [field, messages] of Object.entries(fieldErrors)) {
    if (messages?.[0]) errors[field as Field] = messages[0];
  }
  return errors;
}
