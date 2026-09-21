'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useIntakeStream } from '@/hooks/use-intake-stream';
import { AutoRefresh } from './auto-refresh';
import { Block, RisksSkeleton, SummarySkeleton, TagsSkeleton } from './analysis-blocks';
import { StageStepper } from './stage-stepper';
import { TypedSummary } from './typed-summary';

// The in-flight analysis; the server component owns the finished states.
export function LiveAnalysis({ intakeId }: { intakeId: string }) {
  const router = useRouter();
  const { state, health } = useIntakeStream({ intakeId, enabled: true });

  // The stream is only a preview: once it settles the database decides, which is also how the
  // guardrailed tags and risks arrive.
  useEffect(() => {
    if (state.outcome !== 'running') router.refresh();
  }, [state.outcome, router]);

  return (
    <>
      <StageStepper state={state} />

      <div className="mt-5 space-y-5">
        {state.error && state.outcome === 'running' && (
          <p className="rounded-md bg-amber px-4 py-3 text-sm text-amber-ink">
            An attempt failed, so it is queued to try again. {state.error}
          </p>
        )}

        <Block label="Summary">
          {state.summary ? <TypedSummary text={state.summary} /> : <SummarySkeleton />}
        </Block>
        <Block label="Tags">
          <TagsSkeleton />
        </Block>
        <Block label="Risk checklist">
          <RisksSkeleton />
        </Block>
      </div>

      {/* T5.6: when the stream will not stay up, polling still gets the result on screen. */}
      <AutoRefresh enabled={health === 'degraded'} />
    </>
  );
}
