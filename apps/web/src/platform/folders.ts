/**
 * Opening a project folder in the editor (#142): Chromium's folder picker in a
 * browser, the native one on desktop. Loaded with the editor only.
 */
import { directoryStore, type DirectoryHandleLike } from '@ccg/editor';
import type { OpenedFolder } from '@ccg/editor/ui';
import { desktopOpenFolder, isDesktop, tauriInvoke, tauriListen } from './desktop.js';

type DirectoryPicker = (options?: { mode?: 'read' | 'readwrite' }) => Promise<DirectoryHandleLike>;

/** How to open a folder here, or undefined where the platform can't. */
export function folderOpener(): (() => Promise<OpenedFolder | null>) | undefined {
  if (isDesktop()) return async () => desktopOpenFolder(await tauriInvoke(), await tauriListen());
  const picker = (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
  if (!picker) return undefined;
  return async () => {
    try {
      const dir = await picker({ mode: 'readwrite' });
      return { store: directoryStore(dir), name: dir.name };
    } catch {
      return null; // The user cancelled.
    }
  };
}
