import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Load server/.env (e.g. TEST_DATABASE_URL). Variables already set, as in CI, win.
const envFile = fileURLToPath(new URL('.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.js']
        }
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.js'],
          // Prepares the test database once (see tests/helpers/db.js)
          globalSetup: ['tests/global-setup.js'],
          // All files share one database, so run them one after another
          fileParallelism: false
        }
      }
    ]
  }
});
