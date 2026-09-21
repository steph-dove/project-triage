import type { EventType } from '../events';

export type ClaimedJob = {
  enrichmentId: string;
  intakeId: string;
  attempts: number;
  lockToken: string;
  intake: {
    title: string;
    description: string;
    budgetRange: string;
    timeline: string;
    industry: string;
  };
};

export type EnrichmentResult = {
  summary: string;
  tags: string[];
  risks: string[];
  source: 'LLM' | 'FALLBACK';
  model?: string;
  promptVersion?: string;
  rawResponse?: string;
  latencyMs?: number;
  tokensIn?: number;
  tokensOut?: number;
};

export type FailureOutcome = {
  error: string;
  // Present means put it back to PENDING and try again then; absent means give up and mark FAILED.
  retryAt?: Date;
};

export type QueueEvent = {
  seq: number;
  intakeId: string;
  type: EventType;
  payload: string | null;
  createdAt: Date;
};

export type Subscription = { stop: () => void };

// Terminal writes take a lockToken and return false once it no longer matches, so a worker
// reaped mid-job cannot clobber the job's new owner.
export interface JobStore {
  claim(limit: number): Promise<ClaimedJob[]>;
  heartbeat(enrichmentId: string, lockToken: string): Promise<boolean>;
  complete(enrichmentId: string, lockToken: string, result: EnrichmentResult): Promise<boolean>;
  fail(enrichmentId: string, lockToken: string, outcome: FailureOutcome): Promise<boolean>;
  release(enrichmentId: string, lockToken: string): Promise<boolean>;
  reap(): Promise<number>;
  subscribe(sinceSeq: number, onEvent: (event: QueueEvent) => void): Subscription;
}

export type ProcessorContext = {
  emit: (type: EventType, payload?: unknown) => Promise<void>;
  signal: AbortSignal;
};

export type Processor = (job: ClaimedJob, ctx: ProcessorContext) => Promise<EnrichmentResult>;

// Thrown by a processor when a retry could plausibly succeed (timeouts, 5xx, an unparseable
// response); anything else is terminal and retrying just burns attempts.
export class RetriableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RetriableError';
  }
}
