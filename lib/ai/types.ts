import type { ClaimedJob } from '../queue/types';
import type { TriageOutput } from './contract';

// The model cannot do anything with this one intake, but the deployment is fine, so a
// heuristic triage helps here where a hard failure would not.
export class UnprocessableIntakeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'UnprocessableIntakeError';
  }
}

export type ProviderResult = {
  output: TriageOutput;
  raw: string;
  model: string;
  latencyMs: number;
  tokensIn?: number;
  tokensOut?: number;
  cached?: boolean;
};

export type ProviderContext = {
  signal: AbortSignal;
  onPartial: (summary: string) => void;
};

export type TriageProvider = (
  intake: ClaimedJob['intake'],
  ctx: ProviderContext,
) => Promise<ProviderResult>;
