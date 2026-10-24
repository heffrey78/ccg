/**
 * Assets in a project (#41): what content uses each file, file types for
 * previews, import paths, and a single-file JS module export that any host
 * can load by URL (`PackageRegistry.import`).
 */
import { MANIFEST_PATH } from '@ccg/content';
import { type Project } from './project.js';

export interface AssetUse {
  key: string;
  pointer: string;
}

const escape = (part: string) => part.replace(/~/g, '~0').replace(/\//g, '~1');

/** Every asset reference in the project's items (`art`, `icon` and `background` fields, at any depth), by asset path. */
export function assetRefs(project: Project): Map<string, AssetUse[]> {
  const out = new Map<string, AssetUse[]>();
  for (const [key, item] of Object.entries(project.items)) {
    const walk = (node: unknown, pointer: string): void => {
      if (Array.isArray(node)) node.forEach((x, i) => walk(x, `${pointer}/${i}`));
      else if (typeof node === 'object' && node !== null) {
        for (const [k, v] of Object.entries(node)) {
          if ((k === 'art' || k === 'icon' || k === 'background') && typeof v === 'string') out.set(v, [...(out.get(v) ?? []), { key, pointer: `${pointer}/${escape(k)}` }]);
          else walk(v, `${pointer}/${escape(k)}`);
        }
      }
    };
    walk(item, '');
  }
  return out;
}

const TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  json: 'application/json',
};

export function mimeType(path: string): string {
  return TYPES[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream';
}

/** Where an imported file goes: images under assets/images, audio under assets/audio, with a clean name. */
export function assetPathFor(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
  const base = (dot > 0 ? fileName.slice(0, dot) : fileName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'file';
  const type = mimeType(fileName);
  const folder = type.startsWith('image/') ? 'images' : type.startsWith('audio/') ? 'audio' : 'files';
  return `assets/${folder}/${base}${ext ? `.${ext}` : ''}`;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * The project as one ES module: `export default { manifest, content, assets }`,
 * with assets inlined as data URLs. Hosts load it with `PackageRegistry.import(url)`.
 */
export function moduleSource(project: Project): string {
  const content = Object.entries(project.items)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([, item]) => item);
  const assets = Object.fromEntries(Object.entries(project.assets).map(([path, data]) => [path, `data:${mimeType(path)};base64,${base64(data)}`]));
  return [
    `// ${project.manifest.name} ${project.manifest.version}: a ccg game package exported by the editor (from ${MANIFEST_PATH} and content/).`,
    `const manifest = ${JSON.stringify(project.manifest, null, 2)};`,
    `const content = ${JSON.stringify(content, null, 2)};`,
    `const files = ${JSON.stringify(assets)};`,
    'export default { manifest, content, assets: { url: (path) => files[path] ?? path } };',
    '',
  ].join('\n');
}
