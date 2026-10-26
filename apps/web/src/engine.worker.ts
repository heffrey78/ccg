/// <reference lib="webworker" />
// The engine runs here, off the UI thread, and only sends the player's view
// back. The web host bundles its games; more can be imported by URL.
import { createEngineHost, serveEngine } from '@ccg/client/engine';
import sandbox from '@ccg/game-sandbox';
// Content-only games ship as their files, loaded like an editor export.
import { BUNDLED_IDS, bundledFiles } from './bundled-files.js';

serveEngine(createEngineHost({ packages: [sandbox as never], files: BUNDLED_IDS.map(bundledFiles) }), self as unknown as DedicatedWorkerGlobalScope);
