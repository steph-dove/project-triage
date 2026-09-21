import type { ClaimedJob } from '../queue/types';
import type { TriageOutput } from './contract';

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
