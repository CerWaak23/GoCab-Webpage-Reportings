import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Pruebas que hablan con el proyecto real de Supabase (en modo simulación).
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.js', import.meta.url)),
    },
  },
  test: { include: ['tests/integracion/**/*.test.js'], environment: 'node', testTimeout: 30000 },
});
