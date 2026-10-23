/// <reference lib="webworker" />
// The engine runs here, off the UI thread, and only sends the player's view
// back. The web host bundles its games; more can be imported by URL.
import { createEngineHost, serveEngine } from '@ccg/client/engine';
import sandbox from '@ccg/game-sandbox';

// The content-only example game ships as its files, loaded like an editor export.
const duel = import.meta.glob('../../../examples/duel/**/*.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const encoder = new TextEncoder();
const duelFiles = Object.fromEntries(Object.entries(duel).map(([path, text]) => [path.replace('../../../examples/duel/', ''), encoder.encode(text)]));

serveEngine(createEngineHost({ packages: [sandbox as never], files: [duelFiles] }), self as unknown as DedicatedWorkerGlobalScope);
