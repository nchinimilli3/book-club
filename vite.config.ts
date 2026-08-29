import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const cloud = env.VITE_BACKEND === 'd1';
  return {
    resolve: {
      alias: {
        '@book-club/supabase': fileURLToPath(new URL(cloud ? './src/lib/supabase.cloud.ts' : './src/lib/supabase.ts', import.meta.url)),
        '@book-club/data': fileURLToPath(new URL(cloud ? './src/lib/data.cloud.ts' : './src/lib/data.ts', import.meta.url)),
      },
    },
    // An unset API URL is deliberately a local failure, never a hidden route
    // to the old production backend.
    server: env.VITE_API_BASE_URL ? {
      proxy: { '/api': { target: env.VITE_API_BASE_URL, changeOrigin: true } },
    } : undefined,
  };
});
