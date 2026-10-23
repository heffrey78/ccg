/**
 * An open project: the editor store plus where it saves. Saving writes only
 * changed files and, for browser projects, updates the library entry.
 */
import { useEffect, useReducer } from 'react';
import { EditorStore } from '../store.js';
import { openProject, type Files, type Project } from '../project.js';
import type { ProjectLibrary } from '../stores/indexeddb.js';
import { readAll, saveProject, type ProjectStore } from '../stores/store.js';

export type SessionSource = { kind: 'browser'; id: string } | { kind: 'folder'; name: string };

let sessions = 0;

export class Session {
  /** Distinguishes sessions, e.g. as a React key. */
  readonly id = ++sessions;
  readonly store: EditorStore;
  #saved: Files;

  private constructor(
    project: Project,
    saved: Files,
    readonly target: ProjectStore,
    readonly source: SessionSource,
    private readonly library: ProjectLibrary | null,
  ) {
    this.store = new EditorStore(project);
    this.#saved = saved;
  }

  /** Opens whatever a store holds. */
  static async open(target: ProjectStore, source: SessionSource, library: ProjectLibrary | null): Promise<Session> {
    const files = await readAll(target);
    const opened = openProject(files);
    if (!opened.ok) throw new Error(opened.message);
    return new Session(opened.project, files, target, source, library);
  }

  /** Starts a session for a new project and saves it straight away. */
  static async create(project: Project, target: ProjectStore, source: SessionSource, library: ProjectLibrary | null): Promise<Session> {
    const session = new Session(project, {}, target, source, library);
    await session.save();
    return session;
  }

  async save(): Promise<void> {
    const project = this.store.project;
    this.#saved = await saveProject(project, this.target, this.#saved);
    if (this.source.kind === 'browser') await this.library?.put({ id: this.source.id, name: project.manifest.name, updatedAt: Date.now() });
    // Only mark saved if nothing changed while writing.
    if (this.store.project === project) this.store.markSaved();
  }
}

/** Re-renders when the store changes. */
export function useStore(store: EditorStore): EditorStore {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => store.subscribe(bump), [store]);
  return store;
}
