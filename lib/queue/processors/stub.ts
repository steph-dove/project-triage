import type { Processor } from '../types';

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('aborted'));
      },
      { once: true },
    );
  });

// Stands in for the AI call until Phase 3, so the whole async path can be proved out before any
// model variability is near it.
export const stubProcessor: Processor = async (job, ctx) => {
  await ctx.emit('CALLING_MODEL');
  await sleep(2_000, ctx.signal);

  await ctx.emit('VALIDATING');

  return {
    summary: `Stub analysis of "${job.intake.title}". A ${job.intake.industry} request with a ${job.intake.budgetRange} budget over ${job.intake.timeline}.`,
    tags: ['stub', job.intake.industry.toLowerCase().replace(/\s+/g, '-'), 'needs-review'],
    risks: ['Stub processor, not a real analysis'],
    source: 'FALLBACK',
    promptVersion: 'stub',
  };
};
