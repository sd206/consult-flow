import { defineConfig } from 'vitest/config'
import path from 'node:path'
import dotenv from 'dotenv'

// `server-only` throws outside the Next server bundle; tests run in plain Node.
const alias = {
  '@': path.resolve(__dirname, 'src'),
  'server-only': path.resolve(__dirname, 'tests/stubs/server-only.ts'),
}
const integrationEnv = dotenv.config({ path: '.env.test.local' }).parsed ?? {}

export default defineConfig({
  test: {
    // Not settable per-project in Vitest 3; applies globally (needed by integration tests sharing one DB).
    fileParallelism: false,
    projects: [
      {
        resolve: { alias },
        esbuild: { jsx: 'automatic' as const },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        resolve: { alias },
        esbuild: { jsx: 'automatic' as const },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          testTimeout: 30_000,
          hookTimeout: 30_000,
          env: integrationEnv,
        },
      },
    ],
  },
})
