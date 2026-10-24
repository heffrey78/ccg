/** The page: Play or Create. Its own module, so editing the UI hot-swaps it without restarting the engine. */
import { Suspense, lazy, useEffect, useState } from 'react';
import { App, SettingsStore, memoryStorage, type EngineClient, type KeyValueStorage } from '@ccg/client';
import { indexedDbStorage } from './platform/indexeddb.js';

// Private browsing can disable IndexedDB; fall back to memory rather than failing.
const storage: KeyValueStorage = typeof indexedDB === 'undefined' ? memoryStorage() : indexedDbStorage();
const settings = new SettingsStore(storage);
const params = new URLSearchParams(location.search);
const seed = params.get('seed') ?? undefined;
// Play one encounter rather than the game's run, e.g. `?encounter=duel:first-fight` (handy for testing).
const encounter = params.get('encounter') ?? undefined;
// The editor is its own chunk: players never download it.
const Editor = lazy(() => import('./editor.js'));

const route = () => (location.hash.startsWith('#/create') ? 'create' : 'play');

export function Root({ engine }: { engine: EngineClient }) {
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
        <App engine={engine} platform={{ storage, settings }} {...(seed !== undefined && { seed })} {...(encounter !== undefined && { encounter })} />
      )}
    </>
  );
}
