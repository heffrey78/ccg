/**
 * The content-only games this app ships, as their package files: the Duel
 * example and Sporeline, the reference game. The engine worker loads them to
 * play; the editor opens them to edit.
 */
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

const loaders: Record<string, () => Promise<Record<string, Uint8Array>>> = {
  duel: async () => duel,
  sporeline: async () => {
    const images = await Promise.all(
      Object.entries(sporelineImages).map(async ([path, url]) => [within(path, 'games/reference/'), new Uint8Array(await (await fetch(url)).arrayBuffer())] as const),
    );
    return { ...sporelineText, ...Object.fromEntries(images) };
  },
};

/** A bundled game's files by package id. */
export function bundledFiles(id: string): Promise<Record<string, Uint8Array>> {
  const load = loaders[id];
  if (!load) return Promise.reject(new Error(`no bundled game '${id}'`));
  return load();
}

export const BUNDLED_IDS = Object.keys(loaders);
