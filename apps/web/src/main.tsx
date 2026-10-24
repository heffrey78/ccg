import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { EngineClient, workerTransport } from '@ccg/client/engine';
import { Root } from './Root.js';

// The engine lives here, outside the components, so hot updates to the UI keep the game in progress.
const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
const engine = new EngineClient(workerTransport(worker));

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Root engine={engine} />
  </StrictMode>,
);
