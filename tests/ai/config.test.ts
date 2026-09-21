import { describe, expect, it } from 'vitest';
import { loadAiConfig } from '../../lib/ai/config';

describe('loadAiConfig', () => {
  it('refuses to start against OpenAI without a key', () => {
    expect(() => loadAiConfig({})).toThrow(/OPENAI_API_KEY is required/);
  });

  it('needs no key for the mock provider', () => {
    const config = loadAiConfig({ AI_PROVIDER: 'mock' });

    expect(config.provider).toBe('mock');
    expect(config.model).toBe('mock');
  });

  it('reads the model and timeout', () => {
    const config = loadAiConfig({
      OPENAI_API_KEY: 'sk-test',
      OPENAI_MODEL: 'gpt-4.1-mini',
      AI_TIMEOUT_MS: '5000',
    });

    expect(config.model).toBe('gpt-4.1-mini');
    expect(config.timeoutMs).toBe(5_000);
  });

  it('caches outside production and not in it', () => {
    expect(loadAiConfig({ AI_PROVIDER: 'mock' }).cache).toBe(true);
    expect(loadAiConfig({ AI_PROVIDER: 'mock', NODE_ENV: 'production' }).cache).toBe(false);
    expect(loadAiConfig({ AI_PROVIDER: 'mock', NODE_ENV: 'production', AI_CACHE: '1' }).cache).toBe(
      true,
    );
  });

  it('reads the two forced failure modes under either spelling', () => {
    const forced = (FORCE_AI_FAILURE: string) =>
      loadAiConfig({ AI_PROVIDER: 'mock', FORCE_AI_FAILURE }).forceFailure;

    expect(loadAiConfig({ AI_PROVIDER: 'mock' }).forceFailure).toBeUndefined();
    expect(forced('1')).toBe('retriable');
    expect(forced('RETRIABLE')).toBe('retriable');
    expect(forced('terminal')).toBe('terminal');
    expect(forced('0')).toBeUndefined();
  });

  it('refuses a FORCE_AI_FAILURE value it does not recognise', () => {
    expect(() => loadAiConfig({ AI_PROVIDER: 'mock', FORCE_AI_FAILURE: 'sometimes' })).toThrow(
      /FORCE_AI_FAILURE must be one of/,
    );
  });
});
