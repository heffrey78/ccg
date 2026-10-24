/// <reference lib="webworker" />
// The engine runs here, off the UI thread, and only sends the player's view
// back. The web host bundles its games; more can be imported by URL.
import { createEngineHost, serveEngine } from '@ccg/client/engine';
import sandbox from '@ccg/game-sandbox';

// Content-only games ship as their files, loaded like an editor export: the
// Duel example and Sporeline, the reference game.
const encoder = new TextEncoder();
const filesOf = (raw: Record<string, string>, root: string) => Object.fromEntries(Object.entries(raw).map(([path, text]) => [path.replace(root, ''), encoder.encode(text)]));
const duel = filesOf(import.meta.glob('../../../examples/duel/**/*.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>, '../../../examples/duel/');
const sporeline = filesOf(
  import.meta.glob(['../../../games/reference/game.json', '../../../games/reference/content/**/*.json'], { eager: true, query: '?raw', import: 'default' }) as Record<string, string>,
  '../../../games/reference/',
);

serveEngine(createEngineHost({ packages: [sandbox as never], files: [duel, sporeline] }), self as unknown as DedicatedWorkerGlobalScope);
