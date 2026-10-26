/**
 * The one place that picks the platform (#31): IndexedDB in a browser, the
 * Tauri shell's app-data file on desktop. The rest of the app takes what this
 * module returns.
 */
import { SettingsStore, memoryStorage, type KeyValueStorage, type Platform } from '@ccg/client';
import { desktopStorage, isDesktop, setDesktopFullscreen, tauriInvoke, type Invoke } from './desktop.js';
import { indexedDbStorage } from './indexeddb.js';

/** Storage that waits for the desktop bridge to load before its first call. */
function deferred(load: Promise<KeyValueStorage>): KeyValueStorage {
  return {
    get: async (key) => (await load).get(key),
    set: async (key, value) => (await load).set(key, value),
    delete: async (key) => (await load).delete(key),
    keys: async (prefix) => (await load).keys(prefix),
  };
}

export function createPlatform(options: { desktop?: boolean; invoke?: Promise<Invoke> } = {}): Platform {
  const desktop = options.desktop ?? isDesktop();
  if (desktop) {
    const storage = deferred((options.invoke ?? tauriInvoke()).then(desktopStorage));
    return { storage, settings: new SettingsStore(storage), setFullscreen: setDesktopFullscreen };
  }
  // Private browsing can disable IndexedDB; fall back to memory rather than failing.
  const storage = typeof indexedDB === 'undefined' ? memoryStorage() : indexedDbStorage();
  return { storage, settings: new SettingsStore(storage) };
}
