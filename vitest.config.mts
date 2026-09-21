import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: './tests/global-setup.ts',
    // The suite shares one SQLite file and asserts on row state, so files cannot overlap.
    fileParallelism: false,
    // relativeTime formats against the host clock, so without a fixed zone the date-fallback
    // case passes here and fails east of UTC+12.
    env: { DATABASE_URL: 'file:../data/test.db', TZ: 'UTC' },
  },
});
