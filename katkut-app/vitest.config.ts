import { defineConfig } from 'vitest/config';

// core/ is the pure-TS brain (CLAUDE.md HARD RULE 7). Tests run here in isolation,
// with no React Native / Expo toolchain involved.
export default defineConfig({
  test: {
    include: ['core/**/*.test.ts'],
    environment: 'node',
  },
});
