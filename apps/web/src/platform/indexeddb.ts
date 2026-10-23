/** Key-value storage on IndexedDB: the web platform's saves and settings (#28). */
import type { KeyValueStorage } from '@ccg/client';

const STORE = 'kv';

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

export function indexedDbStorage(name = 'ccg'): KeyValueStorage {
  const db = open(name);
  const store = async (mode: IDBTransactionMode) => (await db).transaction(STORE, mode).objectStore(STORE);
  return {
    async get(key) {
      const value = await wrap((await store('readonly')).get(key));
      return typeof value === 'string' ? value : null;
    },
    async set(key, value) {
      await wrap((await store('readwrite')).put(value, key));
    },
    async delete(key) {
      await wrap((await store('readwrite')).delete(key));
    },
    async keys(prefix = '') {
      const all = await wrap((await store('readonly')).getAllKeys());
      return all.map(String).filter((k) => k.startsWith(prefix)).sort();
    },
  };
}
