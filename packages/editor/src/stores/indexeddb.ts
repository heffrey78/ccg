/**
 * Projects kept in the browser's IndexedDB: a library of projects, each a
 * ProjectStore. Files are stored per project and path.
 */
import type { ProjectStore } from './store.js';

export interface ProjectInfo {
  id: string;
  name: string;
  /** Milliseconds since the epoch. */
  updatedAt: number;
}

export interface ProjectLibrary {
  list(): Promise<ProjectInfo[]>;
  /** Creates or renames a project entry. */
  put(info: ProjectInfo): Promise<void>;
  store(id: string): ProjectStore;
  delete(id: string): Promise<void>;
}

const PROJECTS = 'projects';
const FILES = 'files';

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function indexedDbLibrary(factory: IDBFactory = indexedDB, name = 'ccg-editor'): ProjectLibrary {
  const db = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(PROJECTS, { keyPath: 'id' });
      request.result.createObjectStore(FILES);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const tx = async (stores: string[], mode: IDBTransactionMode) => (await db).transaction(stores, mode);
  /** Every file key of a project: [id, path] pairs. */
  const range = (id: string) => IDBKeyRange.bound([id, ''], [id, '￿']);

  return {
    async list() {
      const all = (await wrap((await tx([PROJECTS], 'readonly')).objectStore(PROJECTS).getAll())) as ProjectInfo[];
      return all.sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async put(info) {
      const t = await tx([PROJECTS], 'readwrite');
      t.objectStore(PROJECTS).put(info);
      await done(t);
    },
    async delete(id) {
      const t = await tx([PROJECTS, FILES], 'readwrite');
      t.objectStore(PROJECTS).delete(id);
      t.objectStore(FILES).delete(range(id));
      await done(t);
    },
    store(id) {
      return {
        async list() {
          const keys = await wrap((await tx([FILES], 'readonly')).objectStore(FILES).getAllKeys(range(id)));
          return keys.map((k) => (k as [string, string])[1]).sort();
        },
        async read(path) {
          const data = await wrap((await tx([FILES], 'readonly')).objectStore(FILES).get([id, path]));
          if (!(data instanceof Uint8Array)) throw new Error(`no such file: ${path}`);
          return data;
        },
        async write(path, data) {
          const t = await tx([FILES], 'readwrite');
          t.objectStore(FILES).put(data, [id, path]);
          await done(t);
        },
        async remove(path) {
          const t = await tx([FILES], 'readwrite');
          t.objectStore(FILES).delete([id, path]);
          await done(t);
        },
      };
    },
  };
}
