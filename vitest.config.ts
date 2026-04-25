import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/*.test.js'],
    exclude: ['**/dist/**', '**/node_modules/**'],
    environment: 'node',
    coverage: {
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**'],
    },
  },
});
