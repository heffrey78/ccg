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

/** What a change on disk did (#142). */
export type DiskChange = { kind: 'reloaded' } | { kind: 'conflict' } | { kind: 'unreadable'; message: string };

const sameFiles = (a: Files, b: Files) => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => b[k] !== undefined && a[k]?.length === b[k].length && a[k].every((x, i) => x === b[k]?.[i]));
};

let sessions = 0;

export class Session {
  /** Distinguishes sessions, e.g. as a React key. */
  readonly id = ++sessions;
  readonly store: EditorStore;
  #saved: Files;
  /** The save in progress, so changes on disk are compared only once it's written. */
  #saving: Promise<void> = Promise.resolve();
  /** Files changed on disk while the project had unsaved changes; the user decides. */
  conflict = false;

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
    const write = async () => {
      const project = this.store.project;
      this.#saved = await saveProject(project, this.target, this.#saved);
      if (this.source.kind === 'browser') await this.library?.put({ id: this.source.id, name: project.manifest.name, updatedAt: Date.now() });
      // Only mark saved if nothing changed while writing.
      if (this.store.project === project) this.store.markSaved();
      this.conflict = false;
    };
    this.#saving = this.#saving.then(write, write);
    await this.#saving;
  }

  /**
   * Follows changes made outside the editor (#142), when the store can watch:
   * a clean project reloads; one with unsaved changes is flagged as a conflict.
   */
  watch(onChange: (change: DiskChange) => void): () => void {
    return this.target.watch?.(() => void this.#checkDisk().then((c) => c && onChange(c))) ?? (() => undefined);
  }

  async #checkDisk(): Promise<DiskChange | null> {
    await this.#saving.catch(() => undefined);
    const files = await readAll(this.target);
    if (sameFiles(files, this.#saved)) return null;
    if (this.store.dirty) {
      this.conflict = true;
      return { kind: 'conflict' };
    }
    return this.#load(files);
  }

  /** Replaces the project with what's on disk, dropping unsaved changes (undo brings them back). */
  async reloadFromDisk(): Promise<DiskChange> {
    await this.#saving.catch(() => undefined);
    return this.#load(await readAll(this.target));
  }

  #load(files: Files): DiskChange {
    const opened = openProject(files);
    if (!opened.ok) return { kind: 'unreadable', message: opened.message };
    this.#saved = files;
    this.conflict = false;
    this.store.replaceFromDisk(opened.project);
    return { kind: 'reloaded' };
  }
}

/** Re-renders when the store changes. */
export function useStore(store: EditorStore): EditorStore {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => store.subscribe(bump), [store]);
  return store;
}
