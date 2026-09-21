import { describe, expect, it } from 'vitest';
import { loadAiConfig } from '../../lib/ai/config';

describe('loadAiConfig', () => {
  it('refuses to start against OpenAI without a key', () => {
    expect(() => loadAiConfig({})).toThrow(/OPENAI_API_KEY is required/);
  });

  it('treats a blank key the way .env.example writes it, as no key at all', () => {
    expect(loadAiConfig({ AI_PROVIDER: 'mock', OPENAI_API_KEY: '' }).apiKey).toBeUndefined();
    expect(() => loadAiConfig({ OPENAI_API_KEY: '   ' })).toThrow(/OPENAI_API_KEY is required/);
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

  it('caches only where NODE_ENV says so, or where AI_CACHE says so', () => {
    const cache = (env: Record<string, string>) =>
      loadAiConfig({ AI_PROVIDER: 'mock', ...env }).cache;

    expect(cache({ NODE_ENV: 'development' })).toBe(true);
    expect(cache({ NODE_ENV: 'test' })).toBe(true);
    expect(cache({ NODE_ENV: 'production' })).toBe(false);
    // A worker started with plain tsx has no NODE_ENV at all.
    expect(cache({})).toBe(false);
    expect(cache({ AI_CACHE: '1' })).toBe(true);
    expect(cache({ NODE_ENV: 'development', AI_CACHE: '0' })).toBe(false);
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

  it('refuses a FORCE_AI_FAILURE value it does not recognise, inherited ones included', () => {
    for (const value of ['sometimes', 'constructor', 'toString']) {
      expect(() => loadAiConfig({ AI_PROVIDER: 'mock', FORCE_AI_FAILURE: value })).toThrow(
        /FORCE_AI_FAILURE must be one of/,
      );
    }
  });
});
