/**
 * Games installed on this device from the editor, where there is no packages folder to put them
 * in: a browser and the Android app. Each is the zip the editor exports, kept in IndexedDB under
 * the game's id, so installing a game again replaces it. Play loads every one alongside the
 * bundled games; a game with a bundled game's id takes its place until it is removed.
 */
import type { InstalledPackage } from '@ccg/client';

const STORE = 'zips';

function open(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export interface DevicePackages {
  list(): Promise<InstalledPackage[]>;
  install(name: string, zip: Uint8Array): Promise<void>;
  remove(name: string): Promise<void>;
}

/** The device's installed games, or undefined where IndexedDB is unavailable (private browsing in some browsers). */
export function devicePackages(name = 'ccg-packages'): DevicePackages | undefined {
  if (typeof indexedDB === 'undefined') return undefined;
  let db: Promise<IDBDatabase> | undefined;
  const store = async (mode: IDBTransactionMode) => (await (db ??= open(name))).transaction(STORE, mode).objectStore(STORE);
  return {
    async list() {
      const s = await store('readonly');
      const [keys, values] = await Promise.all([wrap(s.getAllKeys()), wrap(s.getAll())]);
      return keys.flatMap((key, i) => (values[i] instanceof Uint8Array ? [{ name: String(key), zip: values[i] }] : []));
    },
    async install(game, zip) {
      await wrap((await store('readwrite')).put(zip, game));
    },
    async remove(game) {
      await wrap((await store('readwrite')).delete(game));
    },
  };
}
