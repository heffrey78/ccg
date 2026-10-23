import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { ContentItem } from '@ccg/content';
import { PackageRegistry, isGamePackage } from '@ccg/core';
import {
  EditorError,
  EditorStore,
  assetPathFor,
  assetRefs,
  moduleSource,
  blankProject,
  createItem,
  decodeText,
  deleteItem,
  directoryStore,
  duplicateItem,
  editorOps,
  encodeText,
  indexedDbLibrary,
  memoryStore,
  openProject,
  projectFiles,
  putAsset,
  readAll,
  referencesTo,
  removeAsset,
  renameItem,
  saveProject,
  unzipFiles,
  newItem,
  updateItem,
  updateManifest,
  validateProject,
  zipFiles,
  type Command,
  type DirectoryHandleLike,
  type FileHandleLike,
  type Files,
  type Project,
} from '../src/index.js';

const ops = editorOps();
const FIXTURE = fileURLToPath(new URL('../../content/test/fixtures/sample', import.meta.url));

function readDir(root: string): Files {
  const files: Files = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else files[relative(root, path).split(sep).join('/')] = new Uint8Array(readFileSync(path));
    }
  };
  walk(root);
  return files;
}

function open(files: Files): Project {
  const result = openProject(files);
  if (!result.ok) throw new Error(result.message);
  return result.project;
}

const item = (kind: ContentItem['kind'], id: string, fields: Record<string, unknown> = {}) =>
  ({ formatVersion: 1, kind, id, name: id.toUpperCase(), ...fields }) as ContentItem;

/** A project where card `strike` and status `burn` are referenced from many places. */
function referenced(): Project {
  let p = blankProject({ id: 'demo', name: 'Demo', board: 'grid' });
  const commands: Command[] = [
    createItem(item('status', 'burn', { stacking: 'intensity' })),
    createItem(item('card', 'tutor', { targeting: { kind: 'none' }, effects: [{ op: 'search', def: 'strike' }], keywords: ['burn'] })),
    createItem(item('card', 'ember', { targeting: { kind: 'none' }, effects: [{ op: 'applyStatus', status: 'demo:burn', stacks: 1 }] })),
    createItem(item('unit', 'imp', { hp: 3, statuses: [{ status: 'burn', stacks: 1 }] })),
    ...['a', 'b', 'c'].map((n) =>
      createItem(item('encounter', `pool-${n}`, { units: [{ unit: 'foe', side: 'enemy', pos: '0,0' }], rewards: { cards: ['strike', 'ember'] } })),
    ),
  ];
  for (const c of commands) p = c(p);
  return p;
}

describe('opening and saving', () => {
  it('opens a hand-written package and saves it byte-for-byte unchanged', async () => {
    const files = readDir(FIXTURE);
    const result = openProject(files);
    if (!result.ok) throw new Error(result.message);
    expect(result.issues).toEqual([]);
    expect(Object.keys(result.project.items)).toHaveLength(9);
    expect(projectFiles(result.project)).toEqual(files);

    // Saving an untouched project writes nothing.
    const store = memoryStore(files);
    const writes: string[] = [];
    const watched = { ...store, write: async (path: string, data: Uint8Array) => (writes.push(path), store.write(path, data)) };
    await saveProject(result.project, watched, files);
    expect(writes).toEqual([]);
  });

  it('opens broken content leniently: unreadable files are kept and reported', () => {
    const files = readDir(FIXTURE);
    files['content/cards/broken.json'] = encodeText('{ not json');
    files['content/cards/odd.json'] = encodeText('{"formatVersion": 1, "kind": "card", "id": "odd", "name": "Odd", "effects": "nope"}\n');
    const result = openProject(files);
    if (!result.ok) throw new Error(result.message);
    expect(result.issues.map((i) => i.file)).toEqual(['content/cards/broken.json']);
    expect(result.project.other['content/cards/broken.json']).toBeDefined();
    // Schema-invalid items still open, so they can be fixed in the editor.
    expect(result.project.items['card:odd']).toBeDefined();
    expect(openProject({})).toEqual({ ok: false, message: 'missing game.json' });
  });

  it('saves only what changed and removes deleted files', async () => {
    const files = readDir(FIXTURE);
    const store = memoryStore(files);
    const writes: string[] = [];
    const watched = { ...store, write: async (path: string, data: Uint8Array) => (writes.push(path), store.write(path, data)) };
    let p = open(files);
    p = updateItem('card:strike', { ...(p.items['card:strike'] as ContentItem), name: 'Big Strike' })(p);
    p = deleteItem('tile:wall')(p);
    const saved = await saveProject(p, watched, files);
    expect(writes).toEqual(['content/cards/strike.json']);
    expect(Object.keys(store.files)).not.toContain('content/tiles/wall.json');
    expect(saved).toEqual(store.files);
  });
});

describe('commands and undo', () => {
  const base = referenced();
  const commands: [string, Command][] = [
    ['create', createItem(item('tile', 'mud', {}))],
    ['update', updateItem('unit:hero', { ...(base.items['unit:hero'] as ContentItem), hp: 99 })],
    ['delete', deleteItem('card:tutor')],
    ['duplicate', duplicateItem('card:strike', 'strike-2')],
    ['rename', renameItem('card:strike', 'jab', ops)],
    ['manifest', updateManifest({ ...base.manifest, name: 'Renamed' })],
    ['asset', putAsset('assets/a.png', new Uint8Array([1, 2, 3]))],
  ];

  it.each(commands)('%s undoes to an identical model and redoes', (label, command) => {
    const store = new EditorStore(base);
    const before = structuredClone(store.project);
    store.run(label, command);
    expect(store.dirty).toBe(true);
    const after = structuredClone(store.project);
    expect(after).not.toEqual(before);
    store.undo();
    expect(store.project).toBe(base);
    expect(store.project).toEqual(before);
    expect(store.dirty).toBe(false);
    store.redo();
    expect(store.project).toEqual(after);
    expect(store.undoLabel).toBe(label);
  });

  it('a failing command leaves the project and history alone', () => {
    const store = new EditorStore(base);
    expect(() => store.run('bad', createItem(item('card', 'strike')))).toThrow(EditorError);
    expect(() => store.run('bad', renameItem('card:strike', 'Not Valid', ops))).toThrow(/not a valid id/);
    expect(() => store.run('bad', removeAsset('assets/none.png'))).toThrow(EditorError);
    expect(store.project).toBe(base);
    expect(store.canUndo).toBe(false);
  });

  it('a new command clears redo; marking saved resets dirty', () => {
    const store = new EditorStore(base);
    store.run('a', createItem(item('tile', 'a')));
    store.undo();
    expect(store.canRedo).toBe(true);
    store.run('b', createItem(item('tile', 'b')));
    expect(store.canRedo).toBe(false);
    store.markSaved();
    expect(store.dirty).toBe(false);
    store.undo();
    expect(store.dirty).toBe(true);
  });
});

describe('rename', () => {
  it('renames a card referenced by three reward pools and a search effect, and moves its file', () => {
    const p = referenced();
    // Three reward pools, a search effect, and five copies in the template's ruleset deck.
    expect(referencesTo(p, 'card:strike', ops)).toHaveLength(9);
    const next = renameItem('card:strike', 'jab', ops)(p);
    expect(next.items['card:strike']).toBeUndefined();
    expect(next.items['card:jab']).toMatchObject({ id: 'jab', name: 'Strike' });
    expect(next.paths['card:jab']).toBe('content/cards/jab.json');
    for (const n of ['a', 'b', 'c']) expect((next.items[`encounter:pool-${n}`] as unknown as { rewards: { cards: string[] } }).rewards.cards).toEqual(['jab', 'ember']);
    expect((next.items['card:tutor'] as unknown as { effects: { def: string }[] }).effects[0]?.def).toBe('jab');
    expect(referencesTo(next, 'card:jab', ops)).toHaveLength(9);
    // Items that did not reference the card are shared, not copied.
    expect(next.items['unit:hero']).toBe(p.items['unit:hero']);
  });

  it('renaming a card updates the ruleset deck', () => {
    const next = renameItem('card:strike', 'jab', ops)(referenced());
    expect((next.items['ruleset:main'] as unknown as { player: { deck: string[] } }).player.deck.filter((c) => c === 'jab')).toHaveLength(5);
  });

  it('renames a status in keywords, unit statuses and qualified effect references', async () => {
    const next = renameItem('status:burn', 'scorch', ops)(referenced());
    expect(next.items['card:tutor']).toMatchObject({ keywords: ['scorch'] });
    expect((next.items['card:ember'] as unknown as { effects: { status: string }[] }).effects[0]?.status).toBe('demo:scorch');
    expect(next.items['unit:imp']).toMatchObject({ statuses: [{ status: 'scorch', stacks: 1 }] });
    expect(await validateProject(next)).toEqual([]);
  });

  it('keeps a file name that was not the id', () => {
    let p = referenced();
    p = createItem(item('tile', 'mud'), 'content/terrain/mud-tile.json')(p);
    expect(renameItem('tile:mud', 'bog', ops)(p).paths['tile:bog']).toBe('content/terrain/mud-tile.json');
  });
});

describe('validation and templates', () => {
  it('templates and the sample fixture validate cleanly', async () => {
    expect(await validateProject(blankProject({ id: 'lane-game', name: 'Lane', board: 'lane' }))).toEqual([]);
    expect(await validateProject(blankProject({ id: 'grid-game', name: 'Grid', board: 'grid' }))).toEqual([]);
    expect(await validateProject(open(readDir(FIXTURE)))).toEqual([]);
  });

  it('a new item of every kind is valid as created', async () => {
    let p = blankProject({ id: 'fresh', name: 'Fresh', board: 'lane' });
    for (const kind of ['card', 'unit', 'status', 'tile', 'encounter', 'ruleset'] as const) p = createItem(newItem(kind, `new-${kind}`, `New ${kind}`))(p);
    expect(await validateProject(p)).toEqual([]);
  });

  it('ties issues to the item and field they are in', async () => {
    let p = referenced();
    p = deleteItem('unit:foe')(p);
    p = updateItem('unit:hero', { ...(p.items['unit:hero'] as ContentItem), hp: -1 })(p);
    const issues = await validateProject(p);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'unit:hero', file: 'content/units/hero.json', pointer: '/hp' }),
        expect.objectContaining({ key: 'encounter:pool-a', pointer: '/units/0/unit', message: "unknown unit 'foe'" }),
      ]),
    );
  });

  it('checks references inside effects, which the loader leaves to the registry', async () => {
    const p = deleteItem('status:burn')(referenced());
    const issues = await validateProject(p);
    expect(issues.filter((i) => i.message === "unknown status 'demo:burn'")).toEqual([
      { file: 'content/cards/ember.json', key: 'card:ember', pointer: '/effects/0/status', message: "unknown status 'demo:burn'" },
    ]);
    // Keywords are checked by the loader too; each problem is listed once.
    expect(issues.filter((i) => i.pointer === '/keywords/0')).toHaveLength(1);
  });
});

describe('stores', () => {
  const files = (): Files => ({ 'game.json': encodeText('{}\n'), 'content/cards/a.json': encodeText('{"a":1}\n'), 'assets/x.png': new Uint8Array([9, 8]) });

  it('zip export is deterministic and imports back, dropping a single wrapping folder', () => {
    const zip = zipFiles(files());
    expect(zipFiles(files())).toEqual(zip);
    expect(unzipFiles(zip)).toEqual(files());
    const wrapped = zipFiles(Object.fromEntries(Object.entries(files()).map(([p, d]) => [`my-game/${p}`, d])));
    expect(unzipFiles(wrapped)).toEqual(files());
  });

  it('reads and writes a folder through File System Access handles', async () => {
    const root = fakeDirectory('game');
    const store = directoryStore(root);
    for (const [path, data] of Object.entries(files())) await store.write(path, data);
    await store.write('node_modules/x/index.js', encodeText('ignored'));
    expect(await store.list()).toEqual(['assets/x.png', 'content/cards/a.json', 'game.json']);
    expect(decodeText(await store.read('content/cards/a.json'))).toBe('{"a":1}\n');
    await store.remove('assets/x.png');
    expect(await readAll(store)).toEqual({ 'game.json': files()['game.json'], 'content/cards/a.json': files()['content/cards/a.json'] });
  });

  it('keeps projects in IndexedDB, each with its own files', async () => {
    const library = indexedDbLibrary(indexedDB, `test-${Math.random()}`);
    await library.put({ id: 'one', name: 'One', updatedAt: 1 });
    await library.put({ id: 'two', name: 'Two', updatedAt: 2 });
    const one = library.store('one');
    for (const [path, data] of Object.entries(files())) await one.write(path, data);
    await library.store('two').write('game.json', encodeText('two'));
    expect((await library.list()).map((p) => p.id)).toEqual(['two', 'one']);
    expect(await readAll(one)).toEqual(files());
    await one.remove('assets/x.png');
    expect(await one.list()).toEqual(['content/cards/a.json', 'game.json']);
    await library.delete('one');
    expect((await library.list()).map((p) => p.id)).toEqual(['two']);
    expect(await one.list()).toEqual([]);
    expect(await library.store('two').list()).toEqual(['game.json']);
  });
});

/** An in-memory stand-in for a FileSystemDirectoryHandle. */
function fakeDirectory(name: string): DirectoryHandleLike {
  const children = new Map<string, FileHandleLike | DirectoryHandleLike>();
  const file = (): FileHandleLike => {
    let data = new Uint8Array();
    return {
      kind: 'file',
      getFile: async () => ({ arrayBuffer: async () => data.slice().buffer }),
      createWritable: async () => ({
        write: async (d: Uint8Array) => {
          data = d.slice();
        },
        close: async () => {},
      }),
    };
  };
  const get = <T extends FileHandleLike | DirectoryHandleLike>(key: string, kind: T['kind'], create: boolean | undefined, make: () => T): T => {
    const existing = children.get(key);
    if (existing) {
      if (existing.kind !== kind) throw new TypeError('type mismatch');
      return existing as T;
    }
    if (!create) throw new Error(`NotFoundError: ${key}`);
    const made = make();
    children.set(key, made);
    return made;
  };
  return {
    kind: 'directory',
    name,
    async *entries() {
      yield* children.entries();
    },
    getFileHandle: async (key, options) => get(key, 'file', options?.create, file),
    getDirectoryHandle: async (key, options) => get(key, 'directory', options?.create, () => fakeDirectory(key)),
    removeEntry: async (key) => {
      if (!children.delete(key)) throw new Error(`NotFoundError: ${key}`);
    },
  };
}

describe('assets and export', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

  it('finds which content uses each asset, at any depth', () => {
    let p = blankProject({ id: 'art', name: 'Art', board: 'lane' });
    p = putAsset('assets/images/strike.png', png)(p);
    p = putAsset('assets/images/unused.png', png)(p);
    p = updateItem('card:strike', { ...(p.items['card:strike'] as ContentItem), art: 'assets/images/strike.png' })(p);
    const foe = structuredClone(p.items['unit:foe'] as ContentItem) as ContentItem & { behavior: { then: { intent: Record<string, unknown> } } };
    foe.behavior.then.intent.icon = 'assets/images/strike.png';
    p = updateItem('unit:foe', foe)(p);
    expect(assetRefs(p).get('assets/images/strike.png')).toEqual([
      { key: 'card:strike', pointer: '/art' },
      { key: 'unit:foe', pointer: '/behavior/then/intent/icon' },
    ]);
    expect(assetRefs(p).has('assets/images/unused.png')).toBe(false);
  });

  it('deleting an asset in use is a validation error on the content that uses it', async () => {
    let p = blankProject({ id: 'art', name: 'Art', board: 'lane' });
    p = putAsset('assets/images/strike.png', png)(p);
    p = updateItem('card:strike', { ...(p.items['card:strike'] as ContentItem), art: 'assets/images/strike.png' })(p);
    expect(await validateProject(p)).toEqual([]);
    p = removeAsset('assets/images/strike.png')(p);
    expect(await validateProject(p)).toEqual([
      { file: 'content/cards/strike.json', key: 'card:strike', pointer: '/art', message: "missing asset 'assets/images/strike.png'" },
    ]);
  });

  it('names imported files by type, with clean names', () => {
    expect(assetPathFor('My Hero (final).PNG')).toBe('assets/images/my-hero-final.png');
    expect(assetPathFor('hit.ogg')).toBe('assets/audio/hit.ogg');
    expect(assetPathFor('notes')).toBe('assets/files/notes');
  });

  it('exports a JS module that loads as a game package, assets inlined', async () => {
    let p = blankProject({ id: 'mod', name: 'Mod', board: 'grid' });
    p = putAsset('assets/images/a.png', png)(p);
    const source = moduleSource(p);
    const mod = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)) as { default: { manifest: unknown; content: ContentItem[]; assets: { url(path: string): string } } };
    expect(isGamePackage(mod.default)).toBe(true);
    expect(mod.default.manifest).toEqual(p.manifest);
    expect(mod.default.content.map((i) => `${i.kind}:${i.id}`).sort()).toEqual(Object.keys(p.items).sort());
    expect(mod.default.assets.url('assets/images/a.png')).toBe(`data:image/png;base64,${Buffer.from(png).toString('base64')}`);
    const registry = new PackageRegistry();
    registry.register(mod.default as never);
    const resolved = registry.resolve('mod');
    expect(resolved.ok && resolved.game.createRules().presentation?.board).toMatchObject({ kind: 'square' });
  });
});
