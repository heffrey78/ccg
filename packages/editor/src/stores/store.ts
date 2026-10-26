/**
 * Where a project's files live (#39). The editor reads and writes through
 * this interface, so the same project opens from IndexedDB, a folder on disk
 * (File System Access API) or memory; zip import/export sits on top.
 */
import { decodeText, projectFiles, type Files, type Project } from '../project.js';
import type { FileSource } from '@ccg/content';

export interface ProjectStore {
  /** Every file path, '/'-separated and relative to the project root, sorted. */
  list(): Promise<string[]>;
  read(path: string): Promise<Uint8Array>;
  write(path: string, data: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
  /** Calls back when files may have changed outside the editor (a watched folder, #142); returns a function that stops watching. */
  watch?(onChange: () => void): () => void;
}

export async function readAll(store: ProjectStore): Promise<Files> {
  const files: Files = {};
  for (const path of await store.list()) files[path] = await store.read(path);
  return files;
}

const sameBytes = (a: Uint8Array | undefined, b: Uint8Array) => a !== undefined && a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Saves a project: writes only files that changed since `previous` (what the
 * store held), removes files the project no longer has, and returns the new
 * saved files.
 */
export async function saveProject(project: Project, store: ProjectStore, previous: Files): Promise<Files> {
  const next = projectFiles(project);
  for (const [path, data] of Object.entries(next)) if (!sameBytes(previous[path], data)) await store.write(path, data);
  for (const path of Object.keys(previous)) if (!(path in next)) await store.remove(path);
  return next;
}

export function memoryStore(initial: Files = {}): ProjectStore & { files: Files } {
  const files: Files = { ...initial };
  return {
    files,
    list: async () => Object.keys(files).sort(),
    read: async (path) => {
      const data = files[path];
      if (!data) throw new Error(`no such file: ${path}`);
      return data;
    },
    write: async (path, data) => {
      files[path] = data;
    },
    remove: async (path) => {
      delete files[path];
    },
  };
}

/** A store as a content FileSource, for loaders that read text. */
export function fileSource(files: Files): FileSource {
  return {
    list: async () => Object.keys(files).sort(),
    read: async (path) => {
      const data = files[path];
      if (!data) throw new Error(`no such file: ${path}`);
      return decodeText(data);
    },
  };
}
