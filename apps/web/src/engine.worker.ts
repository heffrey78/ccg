/// <reference lib="webworker" />
// The engine runs here, off the UI thread, and only sends the player's view
// back. The web host bundles its games; more can be imported by URL.
import { createEngineHost, serveEngine } from '@ccg/client/engine';
import sandbox from '@ccg/game-sandbox';

serveEngine(createEngineHost({ packages: [sandbox as never] }), self as unknown as DedicatedWorkerGlobalScope);
