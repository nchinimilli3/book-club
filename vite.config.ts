import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'https://book-club-api.postgradplans.workers.dev',
        changeOrigin: true,
      },
    },
  },
});
