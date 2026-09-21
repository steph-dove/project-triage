import { resolve } from 'node:path';

// Off the usual 3000/3100 range, which dev servers and containers tend to hold already.
export const E2E_PORT = Number(process.env.E2E_PORT ?? 3217);

// Absolute, so the server, the worker and the specs cannot disagree about which file they mean.
export const E2E_DATABASE_URL = `file:${resolve(__dirname, '../../data/e2e.db')}`;

// Set explicitly so they win over .env, which would otherwise leak a developer's
// WORKER_IN_PROCESS=true or real OpenAI key into the run.
export const E2E_ENV = {
  DATABASE_URL: E2E_DATABASE_URL,
  AI_PROVIDER: 'mock',
  FORCE_AI_FAILURE: '',
  WORKER_IN_PROCESS: 'false',
  NEXT_DIST_DIR: '.next-e2e',
};
