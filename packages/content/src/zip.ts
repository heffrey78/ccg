/** Zip archives of a package's files (#41): how editor projects are shared and loaded into the play client. */
import { strFromU8, unzipSync, zipSync } from 'fflate';

/** A package's files: '/'-separated paths relative to the package root. */
export type PackageFiles = Record<string, Uint8Array>;

export function zipFiles(files: PackageFiles): Uint8Array {
  // A fixed timestamp keeps exports of the same files byte-identical.
  return zipSync(Object.fromEntries(Object.entries(files).map(([path, data]) => [path, [data, { mtime: new Date(2000, 0, 1) }]])));
}

/** Unzips a package. If every file sits in one top-level folder (as most zip tools make it), that folder is dropped. */
export function unzipFiles(zip: Uint8Array): PackageFiles {
  const entries = Object.entries(unzipSync(zip)).filter(([path]) => !path.endsWith('/') && !path.startsWith('__MACOSX/'));
  const tops = new Set(entries.map(([path]) => (path.includes('/') ? path.slice(0, path.indexOf('/')) : '')));
  const strip = tops.size === 1 && !tops.has('') ? `${[...tops][0]}/` : '';
  return Object.fromEntries(entries.map(([path, data]) => [path.slice(strip.length), data]));
}

/** Package files as a text FileSource for the loader; binary assets are listed but not decoded. */
export function filesSource(files: PackageFiles): { list(): Promise<string[]>; read(path: string): Promise<string> } {
  return {
    list: async () => Object.keys(files).sort(),
    read: async (path) => {
      const data = files[path];
      if (!data) throw new Error(`no such file: ${path}`);
      return strFromU8(data);
    },
  };
}
