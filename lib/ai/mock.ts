import { heuristicTriage } from './fallback';
import { normalizeTags } from './guardrails';
import type { TriageProvider } from './types';

const STEPS = 3;
const STEP_MS = 150;

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

// Same shape as the real provider with none of the variance, so the e2e suite can assert on
// exact strings.
export const mockProvider: TriageProvider = async (intake, ctx) => {
  const base = heuristicTriage(intake);
  const output = { ...base, tags: normalizeTags(['mock', ...base.tags]) };

  for (let step = 1; step <= STEPS; step += 1) {
    await sleep(STEP_MS, ctx.signal);
    ctx.onPartial(output.summary.slice(0, Math.ceil((output.summary.length * step) / STEPS)));
  }

  return {
    output,
    raw: JSON.stringify(output),
    model: 'mock',
    latencyMs: STEPS * STEP_MS,
    tokensIn: 0,
    tokensOut: 0,
  };
};
