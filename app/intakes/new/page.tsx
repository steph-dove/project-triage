import type { Metadata } from 'next';
import { BackToIntakes } from '@/components/back-link';
import { CreateIntakeForm } from './create-form';

export const metadata: Metadata = { title: 'New intake · Intake Triage' };

const STEPS = [
  'Saved and queued',
  'Summary, tags and risks generated',
  'Ready to triage',
];

export default function NewIntakePage() {
  return (
    <div className="space-y-6">
      <BackToIntakes />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <CreateIntakeForm />
        </div>
        <aside className="rounded-lg border border-line bg-card p-6">
          <h2 className="font-mono text-xs tracking-widest text-faint uppercase">
            What happens next
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-muted">
            The intake saves straight away and analysis runs in the background. You will land on
            the detail page and watch it fill in.
          </p>
          <ol className="mt-5 space-y-3">
            {STEPS.map((step, index) => (
              <li key={step} className="flex items-center gap-3 text-sm">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-line font-mono text-xs text-muted">
                  {index + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}
