import { useEffect, useRef, useState } from 'react';
import { ID_PATTERN } from '@ccg/content';
import { openProject, type Files } from '../project.js';
import type { OpenedFolder } from './EditorApp.js';
import type { ProjectInfo, ProjectLibrary } from '../stores/indexeddb.js';
import { memoryStore } from '../stores/store.js';
import { unzipFiles } from '../stores/zip.js';
import { TEMPLATES, blankProject, type TemplateBoard } from '../templates.js';
import { Session } from './session.js';

/** A game the host ships (e.g. the web app's bundled games) that can be opened for editing. */
export interface InstalledGame {
  id: string;
  name: string;
  description?: string;
  /** Where its files live in the repository, e.g. games/reference, to open with Open folder. */
  folder?: string;
  files(): Promise<Files>;
}

export interface ProjectPickerProps {
  library: ProjectLibrary | null;
  /** Opens a folder picker (File System Access API); absent where unsupported. */
  openFolder?: () => Promise<OpenedFolder | null>;
  /** Games the host ships; each opens as a copy saved in this browser. */
  installed?: InstalledGame[];
  /** Opens this installed game's copy straight away, e.g. from Play's Edit button. */
  edit?: string;
  onOpen(session: Session): void;
}

/** The browser project that holds an installed game's copy. */
const copyId = (game: string) => `edit-${game}`;

/** "My Game!" → "my-game" */
export function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function ProjectPicker({ library, openFolder: pickFolder, installed = [], edit, onOpen }: ProjectPickerProps) {
  const [projects, setProjects] = useState<ProjectInfo[] | null>(null);
  const [name, setName] = useState('');
  const [board, setBoard] = useState<TemplateBoard>('lane');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (library) void library.list().then(setProjects, (e: Error) => setError(e.message));
    else setProjects([]);
  }, [library]);

  const attempt = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** A library id not yet taken: the project id, then id-2, id-3... */
  const freeId = (id: string) => {
    const taken = new Set((projects ?? []).map((p) => p.id));
    let candidate = id;
    for (let n = 2; taken.has(candidate); n++) candidate = `${id}-${n}`;
    return candidate;
  };

  const create = () =>
    attempt(async () => {
      const id = slug(name);
      if (!ID_PATTERN.test(id)) throw new Error('Give the game a name with at least one letter or digit.');
      const project = blankProject({ id, name: name.trim(), board });
      const libraryId = freeId(id);
      const target = library ? library.store(libraryId) : memoryStore();
      onOpen(await Session.create(project, target, { kind: 'browser', id: libraryId }, library));
    });

  const importZip = (file: File) =>
    attempt(async () => {
      const files = unzipFiles(new Uint8Array(await file.arrayBuffer()));
      const opened = openProject(files);
      if (!opened.ok) throw new Error(`${file.name}: ${opened.message}`);
      const libraryId = freeId(slug(opened.project.manifest.id) || 'imported');
      const target = library ? library.store(libraryId) : memoryStore();
      onOpen(await Session.create(opened.project, target, { kind: 'browser', id: libraryId }, library));
    });

  /** Opens an installed game's copy in this browser, making it from the installed files the first time or when starting over. */
  const editInstalled = (game: InstalledGame, fresh = false) =>
    attempt(async () => {
      const id = copyId(game.id);
      const exists = (projects ?? []).some((p) => p.id === id);
      if (library && exists && !fresh) {
        onOpen(await Session.open(library.store(id), { kind: 'browser', id }, library));
        return;
      }
      if (library && exists) await library.delete(id);
      const opened = openProject(await game.files());
      if (!opened.ok) throw new Error(`${game.name}: ${opened.message}`);
      onOpen(await Session.create(opened.project, library ? library.store(id) : memoryStore(), { kind: 'browser', id }, library));
    });

  // Play's Edit button lands here with the game to open, once the project list is known.
  const requested = useRef(false);
  useEffect(() => {
    const game = installed.find((g) => g.id === edit);
    if (!game || projects === null || requested.current) return;
    requested.current = true;
    void editInstalled(game);
  }, [edit, projects]);

  const removeProject = (p: ProjectInfo) =>
    attempt(async () => {
      if (!library || !window.confirm(`Delete ${p.name} from this browser? This can't be undone.`)) return;
      await library.delete(p.id);
      setProjects(await library.list());
    });

  const openFolder = pickFolder && (
    <button
      type="button"
      disabled={busy}
      onClick={() =>
        void attempt(async () => {
          const folder = await pickFolder();
          if (folder) onOpen(await Session.open(folder.store, { kind: 'folder', name: folder.name }, library));
        })
      }
    >
      Open folder…
    </button>
  );
  const copies = new Set(installed.map((g) => copyId(g.id)));
  const own = (projects ?? []).filter((p) => !copies.has(p.id));

  return (
    <section className="ccg-picker" aria-labelledby="picker-heading">
      <h1 id="picker-heading">Edit or create a game</h1>
      {error && <p role="alert" className="ccg-error">{error}</p>}
      <div className="ccg-picker-columns">
        <div className="ccg-panel" role="region" aria-labelledby="open-heading">
          <h2 id="open-heading">Edit a game</h2>
          {installed.length > 0 && (
            <>
              <h3>Installed games</h3>
              <ul className="ccg-project-list">
                {installed.map((game) => {
                  const copy = (projects ?? []).find((p) => p.id === copyId(game.id));
                  return (
                    <li key={game.id}>
                      <div>
                        <strong>{game.name}</strong>
                        {game.description && <div className="ccg-muted">{game.description}</div>}
                        {copy && <div className="ccg-muted">Your copy, saved {new Date(copy.updatedAt).toLocaleString()}</div>}
                      </div>
                      <span className="ccg-row">
                        <button type="button" className="ccg-primary" disabled={busy} onClick={() => void editInstalled(game)}>
                          Edit
                        </button>
                        {copy && (
                          <button type="button" disabled={busy} title="Replace your copy with the installed version" onClick={() => void editInstalled(game, true)}>
                            Start over
                          </button>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="ccg-muted ccg-picker-note">
                Edit works on a copy saved in this browser.{' '}
                {pickFolder
                  ? `To change a game's own files instead, use Open folder and choose its folder${installed.some((g) => g.folder) ? ` (${installed.flatMap((g) => (g.folder ? [`${g.name}: ${g.folder}`] : [])).join(', ')})` : ''}.`
                  : 'To change a game\'s own files instead, open its folder in Chrome or Edge; this browser can\'t open folders.'}
              </p>
            </>
          )}
          <h3>Your projects</h3>
          {projects === null ? (
            <p>Loading…</p>
          ) : own.length === 0 ? (
            <p className="ccg-muted">No projects saved in this browser yet.</p>
          ) : (
            <ul className="ccg-project-list">
              {own.map((p) => (
                <li key={p.id}>
                  <div>
                    <button
                      type="button"
                      className="ccg-project-name"
                      disabled={busy || !library}
                      onClick={() => library && void attempt(async () => onOpen(await Session.open(library.store(p.id), { kind: 'browser', id: p.id }, library)))}
                    >
                      {p.name}
                    </button>
                    <div className="ccg-muted">saved {new Date(p.updatedAt).toLocaleString()}</div>
                  </div>
                  <span className="ccg-row">
                    <button type="button" aria-label={`Delete ${p.name}`} disabled={busy || !library} onClick={() => void removeProject(p)}>
                      Delete
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <h3>From your computer</h3>
          <div className="ccg-row">
            {openFolder}
            <label className="ccg-file-button">
              Import zip…
              <input
                type="file"
                accept=".zip,application/zip"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void importZip(file);
                }}
              />
            </label>
          </div>
          <p className="ccg-muted ccg-picker-note">
            {pickFolder ? 'Open folder edits a game package on disk; saving writes its files.' : "Opening a folder needs Chrome or Edge."} Import zip makes a copy in this browser from an exported zip.
          </p>
        </div>

        <form
          className="ccg-panel"
          aria-labelledby="new-heading"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <h2 id="new-heading">New game</h2>
          <label>
            Game name <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Game" required />
          </label>
          <fieldset>
            <legend>Start from</legend>
            {TEMPLATES.map((t) => (
              <label key={t.board} className="ccg-radio">
                <input type="radio" name="template" checked={board === t.board} onChange={() => setBoard(t.board)} />
                <span>
                  <strong>{t.name}</strong> <span className="ccg-muted">{t.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <button type="submit" className="ccg-primary" disabled={busy}>
            Create project
          </button>
        </form>
      </div>
    </section>
  );
}
