/**
 * A project folder on disk through the File System Access API (Chromium:
 * `showDirectoryPicker`). Typed structurally so tests can pass a fake.
 */
import type { ProjectStore } from './store.js';

export interface FileHandleLike {
  readonly kind: 'file';
  getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
  createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void> }>;
}

export interface DirectoryHandleLike {
  readonly kind: 'directory';
  readonly name: string;
  entries(): AsyncIterable<[string, FileHandleLike | DirectoryHandleLike]>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandleLike>;
  removeEntry(name: string): Promise<void>;
}

/** Folders never part of a package's source. */
const SKIP = new Set(['node_modules', '.git', 'dist']);

export function directoryStore(root: DirectoryHandleLike): ProjectStore {
  const split = (path: string) => {
    const parts = path.split('/');
    return { dirs: parts.slice(0, -1), name: parts.at(-1) as string };
  };
  const dirOf = async (dirs: string[], create: boolean) => {
    let dir = root;
    for (const d of dirs) dir = await dir.getDirectoryHandle(d, { create });
    return dir;
  };

  return {
    async list() {
      const out: string[] = [];
      const walk = async (dir: DirectoryHandleLike, prefix: string) => {
        for await (const [name, handle] of dir.entries()) {
          if (handle.kind === 'directory') {
            if (!SKIP.has(name)) await walk(handle, `${prefix}${name}/`);
          } else out.push(`${prefix}${name}`);
        }
      };
      await walk(root, '');
      return out.sort();
    },
    async read(path) {
      const { dirs, name } = split(path);
      const file = await (await (await dirOf(dirs, false)).getFileHandle(name)).getFile();
      return new Uint8Array(await file.arrayBuffer());
    },
    async write(path, data) {
      const { dirs, name } = split(path);
      const writable = await (await (await dirOf(dirs, true)).getFileHandle(name, { create: true })).createWritable();
      await writable.write(data);
      await writable.close();
    },
    async remove(path) {
      const { dirs, name } = split(path);
      await (await dirOf(dirs, false)).removeEntry(name);
    },
  };
}
