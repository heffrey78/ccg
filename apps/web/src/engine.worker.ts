/// <reference lib="webworker" />
// The engine runs here, off the UI thread, and only sends the player's view
// back. The web host bundles its games; more can be imported by URL.
import { createEngineHost, serveEngine } from '@ccg/client/engine';
import sandbox from '@ccg/game-sandbox';

// Content-only games ship as their files, loaded like an editor export: the
// Duel example and Sporeline, the reference game.
const encoder = new TextEncoder();
/** Package-relative paths: Vite's keys vary with the glob, so cut at the package's own folder. */
const within = (path: string, root: string) => path.slice(path.indexOf(root) + root.length);
const filesOf = (raw: Record<string, string>, root: string) => Object.fromEntries(Object.entries(raw).map(([path, text]) => [within(path, root), encoder.encode(text)]));
const duel = filesOf(import.meta.glob('../../../examples/duel/**/*.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>, 'examples/duel/');
const sporelineText = filesOf(
  import.meta.glob(['../../../games/reference/game.json', '../../../games/reference/content/**/*.json', '../../../games/reference/assets/**/*.svg'], {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>,
  'games/reference/',
);
// Raster art (PNG, WebP, JPEG) is bundled as URLs and fetched as bytes.

const sporelineImages = import.meta.glob('../../../games/reference/assets/**/*.{png,webp,jpg,jpeg}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const sporeline = (async () => {
  const images = await Promise.all(
    Object.entries(sporelineImages).map(async ([path, url]) => [within(path, 'games/reference/'), new Uint8Array(await (await fetch(url)).arrayBuffer())] as const),
  );
  return { ...sporelineText, ...Object.fromEntries(images) };
})();

serveEngine(createEngineHost({ packages: [sandbox as never], files: [duel, sporeline] }), self as unknown as DedicatedWorkerGlobalScope);
