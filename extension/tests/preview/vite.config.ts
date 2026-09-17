import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
// Separate entry/config: never included in production Vite inputs or public assets.
export default defineConfig({ root, publicDir: false, plugins: [react()], resolve: { alias: [
  { find: /^\.\/supabase$/, replacement: resolve(root, 'auth.ts') },
  { find: /^\.\/api$/, replacement: resolve(root, 'api.ts') },
] }, server: { host: '127.0.0.1', port: 4173, strictPort: true, fs: { allow: [resolve(root, '../..')] } } });
