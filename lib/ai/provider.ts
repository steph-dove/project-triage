import type { AiConfig } from './config';
import { mockProvider } from './mock';
import { createOpenAiProvider } from './openai';
import type { TriageProvider } from './types';

export function createProvider(config: AiConfig): TriageProvider {
  return config.provider === 'mock' ? mockProvider : createOpenAiProvider(config);
}
