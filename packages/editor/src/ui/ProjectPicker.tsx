import { useEffect, useState } from 'react';
import { ID_PATTERN } from '@ccg/content';
import { openProject } from '../project.js';
import type { DirectoryHandleLike } from '../stores/fsa.js';
import type { ProjectInfo, ProjectLibrary } from '../stores/indexeddb.js';
import { memoryStore } from '../stores/store.js';
import { unzipFiles } from '../stores/zip.js';
import { TEMPLATES, blankProject, type TemplateBoard } from '../templates.js';
import { directoryStore } from '../stores/fsa.js';
import { Session } from './session.js';

export interface ProjectPickerProps {
  library: ProjectLibrary | null;
  /** Opens a folder picker (File System Access API); absent where unsupported. */
  pickDirectory?: () => Promise<DirectoryHandleLike | null>;
  onOpen(session: Session): void;
}

/** "My Game!" → "my-game" */
export function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function ProjectPicker({ library, pickDirectory, onOpen }: ProjectPickerProps) {
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

  return (
    <section className="ccg-picker" aria-labelledby="picker-heading">
      <h1 id="picker-heading">Create a game</h1>
      {error && <p role="alert" className="ccg-error">{error}</p>}

      <form
        className="ccg-panel"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <h2>New project</h2>
        <label>
          Game name <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Game" required />
        </label>
        <fieldset>
          <legend>Template</legend>
          {TEMPLATES.map((t) => (
            <label key={t.board} className="ccg-radio">
              <input type="radio" name="template" checked={board === t.board} onChange={() => setBoard(t.board)} />
              <strong>{t.name}</strong> <span className="ccg-muted">{t.description}</span>
            </label>
          ))}
        </fieldset>
        <button type="submit" className="ccg-primary" disabled={busy}>
          Create project
        </button>
      </form>

      <div className="ccg-panel">
        <h2>Your projects</h2>
        {projects === null ? (
          <p>Loading…</p>
        ) : projects.length === 0 ? (
          <p className="ccg-muted">No projects saved in this browser yet.</p>
        ) : (
          <ul className="ccg-project-list">
            {projects.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={busy || !library}
                  onClick={() => library && void attempt(async () => onOpen(await Session.open(library.store(p.id), { kind: 'browser', id: p.id }, library)))}
                >
                  {p.name}
                </button>
                <span className="ccg-muted"> saved {new Date(p.updatedAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="ccg-row">
          {pickDirectory && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void attempt(async () => {
                  const dir = await pickDirectory();
                  if (dir) onOpen(await Session.open(directoryStore(dir), { kind: 'folder', name: dir.name }, library));
                })
              }
            >
              Open folder…
            </button>
          )}
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
      </div>
    </section>
  );
}
