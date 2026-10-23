import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, EngineClient, SettingsStore, memoryStorage, workerTransport, type KeyValueStorage } from '@ccg/client';
import { indexedDbStorage } from './platform/indexeddb.js';

const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
const engine = new EngineClient(workerTransport(worker));
// Private browsing can disable IndexedDB; fall back to memory rather than failing.
const storage: KeyValueStorage = typeof indexedDB === 'undefined' ? memoryStorage() : indexedDbStorage();
const seed = new URLSearchParams(location.search).get('seed') ?? undefined;

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App engine={engine} platform={{ storage, settings: new SettingsStore(storage) }} {...(seed !== undefined && { seed })} />
  </StrictMode>,
);
