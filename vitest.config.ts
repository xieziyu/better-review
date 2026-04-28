import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'tests/web/**', 'src/web/**'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    setupFiles: [],
  },
})
