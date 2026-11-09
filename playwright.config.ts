import { defineConfig, devices } from '@playwright/test'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.test.local' })

export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  fullyParallel: false,
  expect: { timeout: 15_000 },
  use: { baseURL: 'http://localhost:3000' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run start',
    port: 3000,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
  },
})
