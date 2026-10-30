/**
 * The one place that picks the platform (#31, #156): IndexedDB in a browser, the
 * Tauri shell's app-data file on desktop and Android. The rest of the app takes
 * what this module returns.
 */
import { SettingsStore, memoryStorage, type KeyValueStorage, type Platform } from '@ccg/client';
import { desktopPackages, desktopStorage, isAndroid, isDesktop, setDesktopFullscreen, tauriInvoke, type Invoke } from './desktop.js';
import { exitAndroid, onAndroidBack, onAndroidBackground } from './android.js';
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

export function createPlatform(options: { desktop?: boolean; android?: boolean; invoke?: Promise<Invoke> } = {}): Platform {
  const desktop = options.desktop ?? isDesktop();
  if (options.android ?? isAndroid()) {
    const storage = deferred((options.invoke ?? tauriInvoke()).then(desktopStorage));
    return { storage, settings: new SettingsStore(storage), playOnly: true, onBack: onAndroidBack, exit: exitAndroid, onBackground: onAndroidBackground };
  }
  if (desktop) {
    const invoke = options.invoke ?? tauriInvoke();
    const storage = deferred(invoke.then(desktopStorage));
    return {
      storage,
      settings: new SettingsStore(storage),
      setFullscreen: setDesktopFullscreen,
      packages: async () => desktopPackages(await invoke),
      revealPackages: async () => (await invoke)<void>('packages_reveal'),
    };
  }
  // Private browsing can disable IndexedDB; fall back to memory rather than failing.
  const storage = typeof indexedDB === 'undefined' ? memoryStorage() : indexedDbStorage();
  return { storage, settings: new SettingsStore(storage) };
}
