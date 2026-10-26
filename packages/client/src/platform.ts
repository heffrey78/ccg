/**
 * Platform services (requirement #6, decision #15). The UI reaches storage and
 * settings only through these interfaces, so the web host and the Tauri host
 * (#31) can each supply their own implementations.
 */

/** Key-value persistence for saves and settings (IndexedDB on web, files on desktop). */
export interface KeyValueStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Keys starting with a prefix, sorted. */
  keys(prefix?: string): Promise<string[]>;
}

/** Small typed settings on top of storage. */
export class SettingsStore {
  constructor(
    private readonly storage: KeyValueStorage,
    private readonly prefix = 'settings:',
  ) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const text = await this.storage.get(this.prefix + key);
    if (text === null) return fallback;
    try {
      return JSON.parse(text) as T;
    } catch {
      return fallback;
    }
  }

  set(key: string, value: unknown): Promise<void> {
    return this.storage.set(this.prefix + key, JSON.stringify(value));
  }
}

/** In-memory storage, for tests and as a fallback when nothing persistent is available. */
export function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const data = new Map(Object.entries(initial));
  return {
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => {
      data.set(key, value);
    },
    delete: async (key) => {
      data.delete(key);
    },
    keys: async (prefix = '') => [...data.keys()].filter((k) => k.startsWith(prefix)).sort(),
  };
}

/** A game package installed on the device (#143): its files, or a zip as the editor exports. */
export type InstalledPackage = { name: string; files: Record<string, Uint8Array> } | { name: string; zip: Uint8Array };

export interface Platform {
  storage: KeyValueStorage;
  settings: SettingsStore;
  /** Game packages installed on the device (desktop's packages folder), loaded alongside the bundled ones. */
  packages?(): Promise<InstalledPackage[]>;
  /** Shows the folder those packages live in. */
  revealPackages?(): Promise<void>;
  /** Native full screen for the app window (desktop); the browser's Fullscreen API is used without it. */
  setFullscreen?(on: boolean): Promise<void>;
}
