import { defineConfig } from 'vitest/config';

/**
 * Unit tests only.
 *
 * `e2e/` is excluded deliberately: those are Playwright specs, and Vitest
 * would try to execute them as unit tests and fail. Keeping the boundary
 * explicit means `npm test` stays fast and always meaningful.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    environment: 'node',
    passWithNoTests: true,
  },
});
