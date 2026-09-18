import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = dirname(fileURLToPath(import.meta.url));
const nodeModules = resolve(webRoot, 'node_modules');

export default defineConfig({
  root: webRoot,
  plugins: [react()],
  resolve: {
    alias: {
      react: resolve(nodeModules, 'react'),
      'react-dom': resolve(nodeModules, 'react-dom'),
      '@supabase/supabase-js': resolve(nodeModules, '@supabase/supabase-js'),
    },
    dedupe: ['react', 'react-dom'],
  },
  define: {
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(''),
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? ''),
  },
  build: {
    outDir: resolve(webRoot, 'dist'),
    emptyOutDir: true,
  },
  server: {
    fs: {
      allow: [resolve(webRoot, '..')],
    },
  },
});
