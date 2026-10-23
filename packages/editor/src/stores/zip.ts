/** Zip import and export of a project's files, for sharing and browsers without folder access. */
import { unzipSync, zipSync } from 'fflate';
import type { Files } from '../project.js';

export function zipFiles(files: Files): Uint8Array {
  // A fixed timestamp keeps exports of the same project byte-identical.
  return zipSync(Object.fromEntries(Object.entries(files).map(([path, data]) => [path, [data, { mtime: new Date(2000, 0, 1) }]])));
}

/** Unzips a project. If every file sits in one top-level folder (as most zip tools make it), that folder is dropped. */
export function unzipFiles(zip: Uint8Array): Files {
  const entries = Object.entries(unzipSync(zip)).filter(([path]) => !path.endsWith('/') && !path.startsWith('__MACOSX/'));
  const tops = new Set(entries.map(([path]) => (path.includes('/') ? path.slice(0, path.indexOf('/')) : '')));
  const strip = tops.size === 1 && !tops.has('') ? `${[...tops][0]}/` : '';
  return Object.fromEntries(entries.map(([path, data]) => [path.slice(strip.length), data]));
}
