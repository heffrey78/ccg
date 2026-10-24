import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig, type Plugin } from 'vite';

/**
 * Vite watches files outside the app one by one, by inode. Git replaces files
 * rather than rewriting them, so after a checkout or pull those watches go
 * stale and the server keeps serving old code. Watching the workspace folders
 * themselves sees replaced files too.
 */
function watchWorkspace(): Plugin {
  const folders = ['packages', 'games', 'examples'].map((folder) => fileURLToPath(new URL(`../../${folder}`, import.meta.url)));
  return {
    name: 'ccg:watch-workspace',
    configureServer(server) {
      server.watcher.add(folders);
    },
  };
}

export default defineConfig({
  plugins: [react(), watchWorkspace()],
  // Use workspace packages' TypeScript source directly, as tests and typecheck do.
  resolve: { conditions: ['@ccg/source', ...defaultClientConditions] },
  worker: { format: 'es' },
  server: { port: 5173, strictPort: true, watch: { ignored: ['**/dist/**', '**/test-results/**', '**/playwright-report/**'] } },
});
