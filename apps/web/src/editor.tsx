/** The web editor: projects in IndexedDB, folders via File System Access, validation in a worker. */
import { indexedDbLibrary, type DirectoryHandleLike, type Project, type ProjectIssue } from '@ccg/editor';
import { EngineClient, workerTransport } from '@ccg/client/engine';
import { EditorApp } from '@ccg/editor/ui';

function workerValidator(): (project: Project) => Promise<ProjectIssue[]> {
  const worker = new Worker(new URL('./validate.worker.ts', import.meta.url), { type: 'module' });
  let next = 0;
  const pending = new Map<number, (issues: ProjectIssue[]) => void>();
  worker.addEventListener('message', (event: MessageEvent<{ id: number; issues: ProjectIssue[] }>) => {
    pending.get(event.data.id)?.(event.data.issues);
    pending.delete(event.data.id);
  });
  return (project) =>
    new Promise((resolve) => {
      const id = next++;
      pending.set(id, resolve);
      worker.postMessage({ id, project });
    });
}

type DirectoryPicker = (options?: { mode?: 'read' | 'readwrite' }) => Promise<DirectoryHandleLike>;
const picker = (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;

const library = typeof indexedDB === 'undefined' ? null : indexedDbLibrary();
const playtestEngine = new EngineClient(workerTransport(new Worker(new URL('./playtest.worker.ts', import.meta.url), { type: 'module' })));
const validate = workerValidator();
const pickDirectory = picker
  ? async () => {
      try {
        return await picker({ mode: 'readwrite' });
      } catch {
        return null; // The user cancelled.
      }
    }
  : undefined;

export default function Editor() {
  return <EditorApp library={library} validate={validate} playtestEngine={playtestEngine} {...(pickDirectory && { pickDirectory })} />;
}
