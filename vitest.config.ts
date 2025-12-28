import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/*/src/**/*.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'packages/render/src/**/*.ts',
        'packages/ai-character/src/**/*.ts',
        'apps/ssh-world/src/**/*.ts',
      ],
    },
    testTimeout: 10000,
  },
});
