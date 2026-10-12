import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'

// https://vite.dev/config/
export default defineConfig({
  // svelteTesting: browser build of Svelte + automatic cleanup in component tests
  plugins: [svelte(), svelteTesting()],
  server: {
    // Forward API calls to the local backend (cd server && npm run dev)
    proxy: {
      '/api': process.env.API_URL ?? 'http://localhost:3000'
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.js'],
    include: ['src/**/*.{test,spec}.{js,ts}']
  }
})
