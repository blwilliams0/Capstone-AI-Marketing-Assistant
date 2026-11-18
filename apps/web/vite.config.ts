import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Reads the repo-root .env.local, but exposes ONLY this explicit allowlist to the browser bundle.
// Server secrets (DATABASE_URL, SUPABASE_SECRET_KEY, ...) can never reach the frontend.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, '../..'), '');
  const mockAuth = mode === 'development' && env.AUTH_MODE === 'mock';
  return {
    plugins: [react(), tailwindcss()],
    server: { port: 5173 },
    define: {
      __SUPABASE_URL__: JSON.stringify(env.SUPABASE_URL ?? ''),
      __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(env.SUPABASE_PUBLISHABLE_KEY ?? ''),
      __API_URL__: JSON.stringify(env.VITE_API_URL ?? 'http://localhost:3000'),
      __MOCK_AUTH__: JSON.stringify(mockAuth),
    },
  };
});
