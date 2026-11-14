import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// PGlite (training mode only) ships its own wasm; keep it out of the dependency pre-bundler
export default defineConfig({ plugins: [react()], base: './', build: { sourcemap: false, target: 'es2022' },
  optimizeDeps: { exclude: ['@electric-sql/pglite'] }, worker: { format: 'es' } });
