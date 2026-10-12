import { defineConfig } from 'vitest/config';

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
