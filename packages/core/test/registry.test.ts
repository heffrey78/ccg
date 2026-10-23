import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { memorySource, type ContentItem } from '@ccg/content';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  PackageRegistry,
  SquareTopology,
  apply,
  boardModule,
  boardTargeting,
  cardText,
  composeRules,
  createBoardState,
  createCardsState,
  createGame,
  defineOp,
  legalActions,
  logicModule,
  statusesModule,
  zone,
  zonesModule,
  type BoardConfig,
  type BoardWorld,
  type CardsWorld,
  type GamePackage,
  type PackageIssue,
} from '../src/index.js';

type World = BoardWorld & CardsWorld;

function starterFiles(): Record<string, string> {
  const root = fileURLToPath(new URL('./fixtures/starter', import.meta.url));
  const files: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else files[relative(root, full).split(sep).join('/')] = readFileSync(full, 'utf8');
    }
  };
  walk(root);
  return files;
}

const card = (id: string, effects: unknown[], extra: object = {}): ContentItem =>
  ({ formatVersion: 1, kind: 'card', id, name: id, targeting: { kind: 'unit', range: 3, filter: 'enemy' }, effects, ...extra }) as ContentItem;

/** An expansion: depends on the starter set, uses its poison, adds a custom op. */
function frost(overrides: Partial<GamePackage<World>> = {}): GamePackage<World> {
  const freeze = defineOp<World>(
    {
      displayName: 'Freeze',
      description: 'Give the target block-breaking frost.',
      params: z.object({ amount: z.number().int().min(1) }),
      text: 'Freeze for {amount}.',
      widgets: { amount: 'number' },
    },
    (ctx, p) => ctx.run([{ op: 'damage', amount: p.amount as number }]),
  );
  const pkg: GamePackage<World> = {
    manifest: { formatVersion: 1, id: 'frost', name: 'Frost', version: '1.0.0', engine: '^0.0.0', depends: { starter: '^0.1.0' } },
    content: [
      card('ice-shard', [{ op: 'frost:freeze', amount: 3 }, { op: 'applyStatus', status: 'starter:poison', stacks: 1 }]),
      card('summon-golem', [{ op: 'spawn', def: 'golem' }], { targeting: { kind: 'tile', range: 1, empty: true } }),
      { formatVersion: 1, kind: 'unit', id: 'golem', name: 'Golem', hp: 15 } as ContentItem,
    ],
    modules: [{ name: 'frost', ops: { 'frost:freeze': freeze } }],
    createRules(game) {
      const config: BoardConfig = { topology: new SquareTopology({ width: 5, height: 5 }), units: game.definitions.units };
      return composeRules<World>({ round: [{ id: 'main', side: 'p', interactive: true }] }, [
        zonesModule<World>(game.definitions.cards, { targeting: boardTargeting<World>(config) }),
        boardModule<World>(config),
        statusesModule<World>(game.definitions.statuses),
        logicModule<World>(),
        ...game.modules,
      ]);
    },
    createSetup(game, { seed }) {
      const cards = createCardsState({ p: ['frost:ice-shard', 'starter:strike'], e: [] }, { resources: { p: { energy: 3 } } });
      zone(cards, 'p', 'hand').push(...zone(cards, 'p', 'draw').splice(0));
      return {
        seed,
        sides: [
          { id: 'p', controller: 'human' },
          { id: 'e', controller: 'ai' },
        ],
        world: {
          cards,
          board: createBoardState(game.definitions.units, [
            { id: 'P', def: 'starter:hero', side: 'p', pos: '1,2', facing: 'e' },
            { id: 'E1', def: 'starter:grunt', side: 'e', pos: '2,2', facing: 'w' },
          ]),
        },
      };
    },
    ...overrides,
  };
  return pkg;
}

async function registryWith(...extra: GamePackage<World>[]) {
  const registry = new PackageRegistry<World>();
  const loaded = await registry.loadFiles(memorySource(starterFiles()));
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.issues));
  for (const pkg of extra) registry.register(pkg);
  return registry;
}

const pointers = (issues: PackageIssue[]) => issues.map((i) => `${i.package}:${i.pointer} ${i.message}`);

describe('PackageRegistry', () => {
  it('resolves an expansion with its base, dependencies first, with qualified ids and references', async () => {
    const result = (await registryWith(frost())).resolve('frost');
    if (!result.ok) throw new Error(pointers(result.issues).join('\n'));
    const { game } = result;
    expect(game.packages.map((p) => p.manifest.id)).toEqual(['starter', 'frost']);
    expect(Object.keys(game.definitions.cards)).toContain('starter:strike');
    expect(game.definitions.cards['frost:ice-shard']?.effects).toEqual([
      { op: 'frost:freeze', amount: 3 },
      { op: 'applyStatus', status: 'starter:poison', stacks: 1 },
    ]);
    // Local references inside each package are qualified with that package's id.
    expect(game.definitions.cards['starter:venom-dart']?.effects[0]).toMatchObject({ status: 'starter:poison' });
    expect(game.definitions.cards['frost:summon-golem']?.effects[0]).toMatchObject({ def: 'frost:golem' });
    expect(game.ops.get('frost:freeze')?.displayName).toBe('Freeze');
    expect(cardText(game.definitions.cards['frost:ice-shard'] as never, game.ops, { name: game.name })).toBe('Freeze for 3. Apply 1 Poison.');
  });

  it('builds a playable game from the root package', async () => {
    const result = (await registryWith(frost())).resolve('frost');
    if (!result.ok) throw new Error('unresolved');
    const rules = result.game.createRules();
    const created = createGame(rules, result.game.createSetup({ seed: 1 }));
    if (!created.ok) throw new Error(created.error.message);
    const play = legalActions(rules, created.state, 'p').find(
      (a) => a.type === 'playCard' && created.state.world.cards.instances[a.card as string]?.def === 'frost:ice-shard',
    );
    const after = apply(rules, created.state, play as never);
    if (!after.ok) throw new Error(after.error.message);
    expect(after.state.world.board.units.E1).toMatchObject({ hp: 7, statuses: { 'starter:poison': 1 } });
  });

  it('reports malformed manifests at the field', async () => {
    const bad = frost({ manifest: { ...frost().manifest, version: 'one' } });
    const result = (await registryWith(bad)).resolve('frost');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ package: 'frost', file: 'game.json', pointer: '/version' }));
  });

  it('rejects an incompatible engine range', async () => {
    const result = (await registryWith(frost({ manifest: { ...frost().manifest, engine: '^1.0.0' } }))).resolve('frost');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(pointers(result.issues)).toEqual([expect.stringMatching(/^frost:\/engine needs engine API \^1\.0\.0/)]);
  });

  it('reports missing dependencies, unsatisfied ranges and cycles', async () => {
    const missing = new PackageRegistry<World>();
    missing.register(frost());
    expect(missing.resolve('frost')).toMatchObject({ ok: false, issues: [{ pointer: '/depends/starter', message: "package 'starter' is not registered" }] });

    const old = await registryWith(frost({ manifest: { ...frost().manifest, depends: { starter: '^2.0.0' } } }));
    expect(old.resolve('frost')).toMatchObject({ ok: false, issues: [{ message: 'needs starter ^2.0.0, but 0.1.0 is registered' }] });

    const cyclic = new PackageRegistry<World>();
    const a = frost({ manifest: { ...frost().manifest, id: 'a', depends: { b: '*' } }, content: [], modules: [] });
    const b = frost({ manifest: { ...frost().manifest, id: 'b', depends: { a: '*' } }, content: [], modules: [] });
    cyclic.register(a);
    cyclic.register(b);
    expect(cyclic.resolve('a')).toMatchObject({ ok: false, issues: [{ message: "dependency cycle through 'a'" }] });
  });

  it('reports unknown references, invalid content, duplicates and unnamespaced ops', async () => {
    const pkg = frost({
      content: [
        card('ice-shard', [{ op: 'applyStatus', status: 'starter:frostbite', stacks: 1 }]),
        card('ice-shard', []),
        card('broken', [{ op: 'frost:freeze', amount: 0 }]),
      ],
      modules: [{ name: 'frost', ops: { 'frost:freeze': frost().modules?.[0]?.ops?.['frost:freeze'] as never, chill: (() => {}) as never } }],
    });
    const opIssue = (await registryWith(pkg)).resolve('frost');
    expect(opIssue.ok).toBe(false);
    if (!opIssue.ok) expect(pointers(opIssue.issues)).toEqual(["frost: op 'chill' must be namespaced as 'frost:…'"]);

    const contentIssues = (await registryWith(frost({ content: pkg.content }))).resolve('frost');
    expect(contentIssues.ok).toBe(false);
    if (!contentIssues.ok) {
      expect(pointers(contentIssues.issues).sort()).toEqual([
        "frost:/effects/0/amount Too small: expected number to be >=1",
        "frost:/effects/0/status unknown status 'starter:frostbite'",
        "frost:/id duplicate card id 'ice-shard'",
      ]);
    }
  });

  it('refuses to register two different packages with the same id', async () => {
    const registry = await registryWith(frost());
    expect(() => registry.register(frost())).toThrow(/already registered/);
  });

  it('imports a package module by file URL', async () => {
    const registry = new PackageRegistry();
    const url = pathToFileURL(fileURLToPath(new URL('./fixtures/packages/tiny-game.mjs', import.meta.url))).href;
    const pkg = await registry.import(url);
    expect(pkg.manifest.id).toBe('tiny');
    const result = registry.resolve('tiny');
    expect(result.ok && Object.keys(result.game.definitions.cards)).toEqual(['tiny:poke']);
  });
});
