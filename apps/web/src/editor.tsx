/** The editor page: projects in IndexedDB, folders on disk (the platform's picker), validation and simulation in workers. */
import { indexedDbLibrary, type Project, type ProjectIssue } from '@ccg/editor';
import { EngineClient, workerTransport } from '@ccg/client/engine';
import { EditorApp, type InstalledGame, type Simulator } from '@ccg/editor/ui';
import type { GameRecord } from '@ccg/core';
import { folderOpener, packageInstaller } from './platform/folders.js';

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

/** Splits a simulation's seeds over a pool of workers, one per spare core. */
function workerSimulator(): Simulator {
  const size = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 1));
  let workers: Worker[] | null = null;
  let next = 0;
  return (project, options, onProgress) => {
    workers ??= Array.from({ length: size }, () => new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' }));
    const chunk = Math.ceil(options.seeds.length / size);
    let done = 0;
    const jobs = workers.map((worker, i) => {
      const seeds = options.seeds.slice(i * chunk, (i + 1) * chunk);
      if (seeds.length === 0) return Promise.resolve([] as GameRecord[]);
      const id = next++;
      return new Promise<GameRecord[]>((resolve, reject) => {
        const onMessage = (event: MessageEvent<{ id: number; records?: GameRecord[]; error?: string }>) => {
          if (event.data.id !== id) return;
          worker.removeEventListener('message', onMessage);
          if (event.data.error) reject(new Error(event.data.error));
          else {
            done += seeds.length;
            onProgress?.(done);
            resolve(event.data.records ?? []);
          }
        };
        worker.addEventListener('message', onMessage);
        worker.postMessage({ id, project, options: { ...options, seeds } });
      });
    });
    // Chunks come back in seed order, so results do not depend on which worker finishes first.
    return Promise.all(jobs).then((parts) => parts.flat());
  };
}

const library = typeof indexedDB === 'undefined' ? null : indexedDbLibrary();
const playtestEngine = new EngineClient(workerTransport(new Worker(new URL('./playtest.worker.ts', import.meta.url), { type: 'module' })));
const validate = workerValidator();
const simulate = workerSimulator();
const openFolder = folderOpener();
const installPackage = packageInstaller();

export default function Editor({ installed, edit, onEdited }: { installed: InstalledGame[]; edit?: string; onEdited(): void }) {
  return (
    <EditorApp
      library={library}
      validate={validate}
      playtestEngine={playtestEngine}
      simulate={simulate}
      installed={installed}
      onEdited={onEdited}
      {...(edit && { edit })}
      {...(openFolder && { openFolder })}
      {...(installPackage && { installPackage })}
    />
  );
}
