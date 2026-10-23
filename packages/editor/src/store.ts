/**
 * The editor store: the current project, undo/redo history and dirty state.
 * Each command's result is kept whole (unchanged items are shared), so undo
 * restores exactly the previous project. Framework-free; UIs subscribe.
 */
import type { Command } from './commands.js';
import type { Project } from './project.js';

export interface HistoryEntry {
  label: string;
  project: Project;
}

export class EditorStore {
  #project: Project;
  #saved: Project;
  #undo: HistoryEntry[] = [];
  #redo: HistoryEntry[] = [];
  readonly #listeners = new Set<() => void>();

  constructor(
    project: Project,
    private readonly limit = 200,
  ) {
    this.#project = project;
    this.#saved = project;
  }

  get project(): Project {
    return this.#project;
  }

  /** Whether the project differs from what was last opened or saved. */
  get dirty(): boolean {
    return this.#project !== this.#saved;
  }

  get canUndo(): boolean {
    return this.#undo.length > 0;
  }

  get canRedo(): boolean {
    return this.#redo.length > 0;
  }

  /** Label of the command undo would revert, for menus. */
  get undoLabel(): string | null {
    return this.#undo.at(-1)?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.#redo.at(-1)?.label ?? null;
  }

  /** Runs a command. Errors propagate and leave the project unchanged. */
  run(label: string, command: Command): void {
    const next = command(this.#project);
    if (next === this.#project) return;
    this.#undo.push({ label, project: this.#project });
    if (this.#undo.length > this.limit) this.#undo.shift();
    this.#redo = [];
    this.#set(next);
  }

  undo(): void {
    const entry = this.#undo.pop();
    if (!entry) return;
    this.#redo.push({ label: entry.label, project: this.#project });
    this.#set(entry.project);
  }

  redo(): void {
    const entry = this.#redo.pop();
    if (!entry) return;
    this.#undo.push({ label: entry.label, project: this.#project });
    this.#set(entry.project);
  }

  /** Records that the current project is what storage now holds. */
  markSaved(): void {
    this.#saved = this.#project;
    this.#notify();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #set(project: Project): void {
    this.#project = project;
    this.#notify();
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}
