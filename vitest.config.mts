import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: './tests/global-setup.ts',
    // The suite shares one SQLite file and asserts on row state, so files cannot overlap.
    fileParallelism: false,
    env: { DATABASE_URL: 'file:../data/test.db' },
  },
});
