import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'coverage/**'],
    restoreMocks: true,
  },
})
