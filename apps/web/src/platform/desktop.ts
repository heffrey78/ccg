/**
 * The desktop adapters (#31): the app's platform services backed by the Tauri
 * shell's commands (`apps/desktop/src-tauri`). Only `platform/index.ts` uses
 * this module; nothing else knows which platform it runs on.
 */
import type { InstalledPackage, KeyValueStorage } from '@ccg/client';
import type { ProjectStore } from '@ccg/editor';

/** Calls a command in the app's shell. */
export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

/** Listens for an event from the desktop shell; resolves to a function that stops listening. */
export type Listen = (event: string, handler: (event: { payload: unknown }) => void) => Promise<() => void>;

/** Whether the page runs inside the desktop shell. */
export const isDesktop = (): boolean => inShell() && !isAndroid();

/** Whether the page runs inside the Android app (#156), the same shell without what needs a desktop. */
export const isAndroid = (): boolean => inShell() && /\bAndroid\b/.test(navigator.userAgent);

const inShell = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Saves and settings in the shell's app-data file. */
export function desktopStorage(invoke: Invoke): KeyValueStorage {
  return {
    get: (key) => invoke<string | null>('kv_get', { key }),
    set: (key, value) => invoke<void>('kv_set', { key, value }),
    delete: (key) => invoke<void>('kv_delete', { key }),
    keys: (prefix) => invoke<string[]>('kv_keys', { prefix: prefix ?? '' }),
  };
}

/** The shell's command bridge, loaded only on desktop. */
export async function tauriInvoke(): Promise<Invoke> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke as Invoke;
}

/** The shell's event listener, loaded only on desktop. */
export async function tauriListen(): Promise<Listen> {
  const { listen } = await import('@tauri-apps/api/event');
  return listen as Listen;
}

/**
 * A project folder the user opened on desktop (#142), as the editor's store.
 * Changes on disk arrive as `folder-changed` events, gathered for 300 ms so a
 * save or a git checkout reads as one change.
 */
export function desktopFolderStore(invoke: Invoke, id: number, listen: Listen): ProjectStore {
  return {
    list: () => invoke<string[]>('folder_list', { id }),
    read: async (path) => new Uint8Array(await invoke<ArrayBuffer>('folder_read', { id, path })),
    write: (path, data) => invoke<void>('folder_write', { id, path, data: Array.from(data) }),
    remove: (path) => invoke<void>('folder_remove', { id, path }),
    watch(onChange) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stop = listen('folder-changed', (event) => {
        if (event.payload !== id) return;
        clearTimeout(timer);
        timer = setTimeout(onChange, 300);
      });
      return () => {
        clearTimeout(timer);
        void stop.then((off) => off());
      };
    },
  };
}

/** Asks for a folder with the native picker; null if the user cancels. */
export async function desktopOpenFolder(invoke: Invoke, listen: Listen): Promise<{ store: ProjectStore; name: string } | null> {
  const opened = await invoke<{ id: number; name: string } | null>('folder_open');
  return opened && { store: desktopFolderStore(invoke, opened.id, listen), name: opened.name };
}

/** Every package in the packages folder (#143): a folder's files, or a zip's bytes. */
export async function desktopPackages(invoke: Invoke): Promise<InstalledPackage[]> {
  const listed = await invoke<({ kind: 'folder'; name: string; files: string[] } | { kind: 'zip'; name: string })[]>('packages_list');
  const read = async (name: string, path?: string) => new Uint8Array(await invoke<ArrayBuffer>('packages_read', { name, ...(path && { path }) }));
  return Promise.all(
    listed.map(async (p): Promise<InstalledPackage> => {
      if (p.kind === 'zip') return { name: p.name, zip: await read(p.name) };
      const files: Record<string, Uint8Array> = {};
      for (const path of p.files) files[path] = await read(p.name, path);
      return { name: p.name, files };
    }),
  );
}

/** Installs an exported zip in the packages folder, replacing an earlier one of the same name. */
export const desktopInstallPackage = (invoke: Invoke) => (name: string, zip: Uint8Array) => invoke<void>('packages_install', { name, data: Array.from(zip) });

/** Native full screen for the app window. */
export async function setDesktopFullscreen(on: boolean): Promise<void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().setFullscreen(on);
}
