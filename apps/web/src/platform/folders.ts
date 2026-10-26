/**
 * The editor's disk access: opening a project folder (#142) with Chromium's
 * folder picker in a browser or the native one on desktop, and installing an
 * exported game into desktop's packages folder (#143). Loaded with the editor only.
 */
import { directoryStore, type DirectoryHandleLike } from '@ccg/editor';
import type { OpenedFolder } from '@ccg/editor/ui';
import { desktopInstallPackage, desktopOpenFolder, isDesktop, tauriInvoke, tauriListen } from './desktop.js';

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

/** Installing an exported game where Play finds it: desktop's packages folder (#143); none in a browser. */
export function packageInstaller(): ((name: string, zip: Uint8Array) => Promise<void>) | undefined {
  if (!isDesktop()) return undefined;
  return async (name, zip) => desktopInstallPackage(await tauriInvoke())(name, zip);
}
