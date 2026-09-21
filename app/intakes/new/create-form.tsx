'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
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
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        if (body?.fieldErrors) setErrors(firstMessages(body.fieldErrors));
        setSubmitError(body?.error ?? `The server rejected the intake (${response.status}).`);
        return;
      }

      router.push(`/intakes/${body.id}`);
    } catch (err) {
      console.error('[create] could not submit the intake', err);
      setSubmitError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate className="rounded-lg border border-line bg-card p-8">
      <h1 className="font-serif text-3xl">New intake</h1>

      <div className="mt-6 space-y-5">
        <Field label="Title" error={errors.title}>
          <input
            type="text"
            value={values.title}
            onChange={update('title')}
            className={inputClass(errors.title)}
          />
        </Field>

        <Field label="Description" error={errors.description}>
          <textarea
            rows={4}
            value={values.description}
            onChange={update('description')}
            className={inputClass(errors.description)}
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Budget range" error={errors.budgetRange}>
            <input
              type="text"
              value={values.budgetRange}
              onChange={update('budgetRange')}
              className={inputClass(errors.budgetRange)}
            />
          </Field>
          <Field label="Timeline" error={errors.timeline}>
            <input
              type="text"
              value={values.timeline}
              onChange={update('timeline')}
              className={inputClass(errors.timeline)}
            />
          </Field>
          <Field label="Industry" error={errors.industry}>
            <input
              type="text"
              value={values.industry}
              onChange={update('industry')}
              className={inputClass(errors.industry)}
            />
          </Field>
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

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold">{label}</span>
      <span className="mt-1.5 block">{children}</span>
      {error && <span className="mt-1.5 block text-sm text-clay-ink">{error}</span>}
    </label>
  );
}

const inputClass = (error?: string) =>
  `w-full rounded-md border bg-card px-3 py-2.5 text-sm ${error ? 'border-clay-ink' : 'border-line'}`;

// Zod hands back every failure per field; the first one is the one worth acting on.
function firstMessages(fieldErrors: Partial<Record<string, string[]>>): Errors {
  const errors: Errors = {};
  for (const [field, messages] of Object.entries(fieldErrors)) {
    if (messages?.[0]) errors[field as Field] = messages[0];
  }
  return errors;
}
