import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Use workspace packages' TypeScript source directly, as tests and typecheck do.
  resolve: { conditions: ['@ccg/source', ...defaultClientConditions] },
  worker: { format: 'es' },
  server: { port: 5173, strictPort: true },
});
