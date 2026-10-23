import Ajv2020Module from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import {
  Migrator,
  createContentSchemas,
  exportJsonSchemas,
  loadPackage,
  serializeItem,
  type ContentIssue,
  type LoadedPackage,
} from '../src/index.js';
import { readTree, sampleOps, sampleSource, SAMPLE_DIR, schemas } from './helpers.js';

// ajv is CommonJS: the class is both module.exports and its `default` property.
const Ajv2020 = Ajv2020Module.default;

const editJson = (files: Record<string, string>, path: string, edit: (doc: Record<string, unknown>) => void) => {
  const doc = JSON.parse(files[path] as string) as Record<string, unknown>;
  edit(doc);
  files[path] = JSON.stringify(doc);
};

const issuesFor = (pkg: LoadedPackage, file: string) => pkg.issues.filter((i) => i.file === file);

describe('loadPackage on the sample fixture', () => {
  it('loads the manifest, every item and the assets with no issues', async () => {
    const pkg = await loadPackage(sampleSource(), schemas);
    expect(pkg.issues).toEqual([]);
    expect(pkg.manifest?.id).toBe('sample');
    expect(pkg.items.map((i) => `${i.item.kind}:${i.item.id}`).sort()).toEqual([
      'card:fan-of-flames',
      'card:shove',
      'card:strike',
      'encounter:first-fight',
      'status:burn',
      'tile:spikes',
      'tile:wall',
      'unit:grunt',
      'unit:hero',
    ]);
    expect(pkg.assets).toEqual(['assets/cards/strike.png']);
    expect(pkg.migrated).toEqual([]);
  });

  it('round-trips every file byte for byte', async () => {
    const files = readTree(SAMPLE_DIR);
    const pkg = await loadPackage(sampleSource(), schemas);
    expect(serializeItem(pkg.manifest as never)).toBe(files['game.json']);
    for (const { path, item } of pkg.items) expect(serializeItem(item)).toBe(files[path]);
  });

  it('normalizes hand-edited formatting on save', async () => {
    const pkg = await loadPackage(
      sampleSource((files) => editJson(files, 'content/units/hero.json', () => {})),
      schemas,
    );
    const hero = pkg.items.find((i) => i.item.id === 'hero');
    expect(serializeItem(hero?.item as never)).toBe(readTree(SAMPLE_DIR)['content/units/hero.json']);
  });

  it('validates every fixture file against the exported JSON Schema', async () => {
    const exported = exportJsonSchemas(schemas);
    const ajv = new Ajv2020({ strict: false });
    const validateItem = ajv.compile(exported.item);
    const validateManifest = ajv.compile(exported.manifest);
    const files = readTree(SAMPLE_DIR);
    expect(validateManifest(JSON.parse(files['game.json'] as string))).toBe(true);
    for (const [path, text] of Object.entries(files)) {
      if (!path.startsWith('content/')) continue;
      const ok = validateItem(JSON.parse(text));
      expect({ path, ok, errors: validateItem.errors ?? null }).toEqual({ path, ok: true, errors: null });
    }
    expect(validateItem({ formatVersion: 1, kind: 'card', id: 'x', name: 'X' })).toBe(false);
  });
});

describe('loadPackage reports problems with JSON Pointers', () => {
  const load = (edit: (files: Record<string, string>) => void) => loadPackage(sampleSource(edit), schemas);

  it('points at a bad effect parameter', async () => {
    const pkg = await load((files) =>
      editJson(files, 'content/cards/strike.json', (d) => {
        (d.effects as Record<string, unknown>[])[0] = { op: 'damage', amount: -1 };
      }),
    );
    expect(issuesFor(pkg, 'content/cards/strike.json').map((i) => i.pointer)).toEqual(['/effects/0/amount']);
  });

  it('rejects unknown ops, unknown fields and bad ids', async () => {
    const pkg = await load((files) => {
      editJson(files, 'content/cards/strike.json', (d) => {
        d.effects = [{ op: 'explode' }];
      });
      editJson(files, 'content/units/hero.json', (d) => {
        d.speed = 3;
      });
      editJson(files, 'content/tiles/wall.json', (d) => {
        d.id = 'Wall';
      });
    });
    expect(issuesFor(pkg, 'content/cards/strike.json')[0]?.pointer).toBe('/effects/0/op');
    expect(issuesFor(pkg, 'content/units/hero.json')[0]?.pointer).toBe('');
    expect(issuesFor(pkg, 'content/units/hero.json')[0]?.message).toMatch(/speed/);
    expect(issuesFor(pkg, 'content/tiles/wall.json')[0]?.pointer).toBe('/id');
  });

  it('reports invalid JSON and a missing manifest', async () => {
    const pkg = await load((files) => {
      files['content/units/hero.json'] = '{ "kind": ';
      delete files['game.json'];
    });
    expect(pkg.manifest).toBeNull();
    expect(pkg.issues.map((i: ContentIssue) => [i.file, i.pointer])).toEqual(
      expect.arrayContaining([
        ['game.json', ''],
        ['content/units/hero.json', ''],
      ]),
    );
  });

  it('requires file names to match ids and ids to be unique per kind', async () => {
    const pkg = await load((files) => {
      files['content/units/other-hero.json'] = files['content/units/hero.json'] as string;
      files['content/units/copies/hero.json'] = files['content/units/hero.json'] as string;
    });
    expect(issuesFor(pkg, 'content/units/other-hero.json')[0]?.message).toMatch(/must match the file name/);
    expect(issuesFor(pkg, 'content/units/hero.json')[0]?.message ?? issuesFor(pkg, 'content/units/copies/hero.json')[0]?.message).toMatch(/duplicate unit id 'hero'/);
  });

  it('reports dangling local references and missing assets, but not cross-package references', async () => {
    const pkg = await load((files) => {
      editJson(files, 'content/encounters/first-fight.json', (d) => {
        (d.units as Record<string, unknown>[])[1] = { unit: 'ogre', side: 'enemy', pos: '4,2' };
        (d.tiles as Record<string, string>)['1,1'] = 'other-pack:lava';
      });
      delete files['assets/cards/strike.png'];
    });
    expect(issuesFor(pkg, 'content/encounters/first-fight.json')).toEqual([
      { file: 'content/encounters/first-fight.json', pointer: '/units/1/unit', message: "unknown unit 'ogre'" },
    ]);
    expect(issuesFor(pkg, 'content/cards/strike.json')).toEqual([
      { file: 'content/cards/strike.json', pointer: '/art', message: "missing asset 'assets/cards/strike.png'" },
    ]);
  });
});

describe('format versions and migrations', () => {
  it('rejects files from a newer format', async () => {
    const pkg = await loadPackage(
      sampleSource((files) => editJson(files, 'content/units/hero.json', (d) => (d.formatVersion = 99))),
      schemas,
    );
    expect(issuesFor(pkg, 'content/units/hero.json')).toEqual([
      expect.objectContaining({ pointer: '/formatVersion', message: expect.stringMatching(/newer/) }),
    ]);
  });

  it('migrates an older file through each step and reports it as migrated', async () => {
    // Pretend the format is now version 2, and version 1 stored HP as `health`.
    const v2 = new Migrator(2, { 1: ({ health, ...rest }) => (health === undefined ? rest : { ...rest, hp: health }) });
    const pkg = await loadPackage(
      sampleSource((files) =>
        editJson(files, 'content/units/hero.json', (d) => {
          d.health = d.hp;
          delete d.hp;
        }),
      ),
      createContentSchemas(sampleOps(), { formatVersion: 2 }),
      v2,
    );
    expect(pkg.issues).toEqual([]);
    expect(pkg.migrated).toContain('content/units/hero.json');
    expect(pkg.items.find((i) => i.item.id === 'hero')?.item).toMatchObject({ formatVersion: 2, hp: 40 });
  });

  it('chains steps and reports a missing one', () => {
    const chain = new Migrator(3, {
      1: (d) => ({ ...d, a: true }),
      2: (d) => ({ ...d, b: true }),
    });
    expect(chain.migrate({ formatVersion: 1 })).toEqual({
      ok: true,
      migrated: true,
      doc: { formatVersion: 3, a: true, b: true },
    });
    expect(chain.migrate({ formatVersion: 3 })).toEqual({ ok: true, migrated: false, doc: { formatVersion: 3 } });
    expect(new Migrator(3, { 1: (d) => d }).migrate({ formatVersion: 1 })).toEqual({
      ok: false,
      message: 'no migration from formatVersion 2',
    });
  });
});
