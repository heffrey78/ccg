import { describe, expect, it } from 'vitest';
import { blankProject, editorOps, memoryStore, projectFiles, renameItem, updateManifest, type ProjectStore } from '../src/index.js';
import { Session, type DiskChange } from '../src/ui/session.js';

/** A memory store whose changes outside the editor we trigger by hand, as a watched folder reports them. */
function watchedStore() {
  const inner = memoryStore();
  let notify = () => undefined as void;
  const store: ProjectStore = { ...inner, watch: (onChange) => ((notify = onChange), () => undefined) };
  return { store, files: inner.files, changed: () => notify() };
}
const enc = new TextEncoder();
const rename = (files: Record<string, Uint8Array>, name: string) => {
  const manifest = JSON.parse(new TextDecoder().decode(files['game.json']));
  files['game.json'] = enc.encode(`${JSON.stringify({ ...manifest, name })}\n`);
};
const next = (session: Session) => new Promise<DiskChange>((resolve) => session.watch(resolve));

describe('folders changed outside the editor (#142)', () => {
  it('reloads a clean project, and undo brings back the version before', async () => {
    const { store, files, changed } = watchedStore();
    const session = await Session.create(blankProject({ id: 'x', name: 'Before', board: 'lane' }), store, { kind: 'folder', name: 'x' }, null);
    const change = next(session);
    rename(files, 'Edited elsewhere');
    changed();
    expect(await change).toEqual({ kind: 'reloaded' });
    expect(session.store.project.manifest.name).toBe('Edited elsewhere');
    expect(session.store.dirty).toBe(false);
    session.store.undo();
    expect(session.store.project.manifest.name).toBe('Before');
  });

  it('flags a project with unsaved changes instead of overwriting them, until the user picks', async () => {
    const { store, files, changed } = watchedStore();
    const session = await Session.create(blankProject({ id: 'x', name: 'Mine', board: 'lane' }), store, { kind: 'folder', name: 'x' }, null);
    session.store.run('Rename', updateManifest({ ...session.store.project.manifest, name: 'Mine, unsaved' }));
    const change = next(session);
    rename(files, 'Theirs');
    changed();
    expect(await change).toEqual({ kind: 'conflict' });
    expect(session.conflict).toBe(true);
    expect(session.store.project.manifest.name).toBe('Mine, unsaved');
    expect(await session.reloadFromDisk()).toEqual({ kind: 'reloaded' });
    expect(session.store.project.manifest.name).toBe('Theirs');
    expect(session.conflict).toBe(false);
  });

  it('ignores its own saves, and reports files it cannot open', async () => {
    const { store, files, changed } = watchedStore();
    const session = await Session.create(blankProject({ id: 'x', name: 'Mine', board: 'lane' }), store, { kind: 'folder', name: 'x' }, null);
    const seen: DiskChange[] = [];
    session.watch((c) => seen.push(c));
    session.store.run('Rename card', renameItem('card:strike', 'jab', editorOps()));
    await session.save();
    changed();
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual([]);
    expect(Object.keys(files).sort()).toEqual(Object.keys(projectFiles(session.store.project)).sort());

    files['game.json'] = enc.encode('{ not json');
    changed();
    await new Promise((r) => setTimeout(r, 20));
    expect(seen[0]?.kind).toBe('unreadable');
    expect(session.store.project.manifest.name).toBe('Mine');
  });
});
