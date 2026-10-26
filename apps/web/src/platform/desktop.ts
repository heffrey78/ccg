/**
 * The desktop adapters (#31): the app's platform services backed by the Tauri
 * shell's commands (`apps/desktop/src-tauri`). Only `platform/index.ts` uses
 * this module; nothing else knows which platform it runs on.
 */
import type { KeyValueStorage } from '@ccg/client';

/** Calls a command in the desktop shell. */
export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

/** Whether the page runs inside the desktop shell. */
export const isDesktop = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

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

/** Native full screen for the app window. */
export async function setDesktopFullscreen(on: boolean): Promise<void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().setFullscreen(on);
}
