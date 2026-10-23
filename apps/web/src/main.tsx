import { StrictMode, Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App, EngineClient, SettingsStore, memoryStorage, workerTransport, type KeyValueStorage } from '@ccg/client';
import { indexedDbStorage } from './platform/indexeddb.js';

const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
const engine = new EngineClient(workerTransport(worker));
// Private browsing can disable IndexedDB; fall back to memory rather than failing.
const storage: KeyValueStorage = typeof indexedDB === 'undefined' ? memoryStorage() : indexedDbStorage();
const seed = new URLSearchParams(location.search).get('seed') ?? undefined;
// The editor is its own chunk: players never download it.
const Editor = lazy(() => import('./editor.js'));

const route = () => (location.hash.startsWith('#/create') ? 'create' : 'play');

function Root() {
  const [page, setPage] = useState(route);
  useEffect(() => {
    const onHash = () => setPage(route());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return (
    <>
      <nav aria-label="Mode" style={{ display: 'flex', gap: 16, padding: '8px 16px', fontFamily: 'system-ui, sans-serif' }}>
        <a href="#/" aria-current={page === 'play' ? 'page' : undefined}>
          Play
        </a>
        <a href="#/create" aria-current={page === 'create' ? 'page' : undefined}>
          Create
        </a>
      </nav>
      {page === 'create' ? (
        <div style={{ padding: 16, maxWidth: 1200, margin: '0 auto' }}>
          <Suspense fallback={<p>Loading the editor…</p>}>
            <Editor />
          </Suspense>
        </div>
      ) : (
        <App engine={engine} platform={{ storage, settings: new SettingsStore(storage) }} {...(seed !== undefined && { seed })} />
      )}
    </>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
