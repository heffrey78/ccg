import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { zipFiles } from '@ccg/content';
import {
  LaneTopology,
  boardModule,
  boardTargeting,
  composeRules,
  createBoardState,
  createCardsState,
  zone,
  zonesModule,
  type BoardWorld,
  type CardsWorld,
  type GamePackage,
} from '@ccg/core';
import { EngineClient, SettingsStore, createEngineHost, localTransport, memoryStorage, serveEngine, workerTransport } from '../src/index.js';

type World = BoardWorld & CardsWorld;

/** A two-sided fixture game: each side has a deck; side `e` is AI-controlled. */
function fixture(): GamePackage<World> {
  const card = (id: string, effects: object[]) => ({ formatVersion: 1, kind: 'card', id, name: id.toUpperCase(), targeting: { kind: 'none' }, effects }) as never;
  return {
    manifest: { formatVersion: 1, id: 'fixture', name: 'Fixture Game', version: '1.0.0', engine: '^0.0.0', description: 'For host tests.' },
    content: [
      card('poke', [{ op: 'draw', n: 1 }]),
      card('wait', []),
      { formatVersion: 1, kind: 'unit', id: 'pawn', name: 'Pawn', hp: 5 } as never,
    ],
    createRules(game) {
      const board = { topology: new LaneTopology(5), units: game.definitions.units };
      return composeRules<World>({ round: [{ id: 'main', perSide: true, interactive: true }] }, [
        zonesModule<World>(game.definitions.cards, { targeting: boardTargeting<World>(board) }),
        boardModule<World>(board),
      ]);
    },
    createSetup(game, { seed }) {
      const deck = ['fixture:poke', 'fixture:wait', 'fixture:poke', 'fixture:wait'];
      const cards = createCardsState({ p: deck, e: deck });
      for (const side of ['p', 'e']) zone(cards, side, 'hand').push(...zone(cards, side, 'draw').splice(0, 2));
      return {
        seed,
        sides: [
          { id: 'p', controller: 'human' },
          { id: 'e', controller: 'ai' },
        ],
        world: {
          cards,
          board: createBoardState(game.definitions.units, [
            { id: 'A', def: 'fixture:pawn', side: 'p', pos: '0', facing: 'e' },
            { id: 'B', def: 'fixture:pawn', side: 'e', pos: '4', facing: 'w' },
          ]),
        },
      };
    },
  };
}

const library: GamePackage<unknown> = { manifest: { formatVersion: 1, id: 'library', name: 'Library', version: '1.0.0', engine: '^0.0.0' }, content: [] };
const client = () => new EngineClient(localTransport(createEngineHost({ packages: [fixture() as GamePackage<unknown>, library] })));

describe('engine host', () => {
  it('lists playable games only', async () => {
    expect(await client().listGames()).toEqual([{ id: 'fixture', name: 'Fixture Game', version: '1.0.0', description: 'For host tests.' }]);
  });

  it('starts a game and returns the human side’s view, legal actions and names', async () => {
    const snap = await client().start('fixture', 1);
    expect(snap.side).toBe('p');
    expect(snap.deciding).toBe('p');
    expect(snap.legal.map((a) => a.type)).toEqual(['playCard', 'playCard', 'endTurn']);
    expect(snap.catalog.names['fixture:poke']).toBe('POKE');
    expect(snap.catalog.cards['fixture:poke']).toMatchObject({ name: 'POKE', text: 'Draw 1 card.', timing: 'main', cost: {} });
    expect(snap.presentation.board).toMatchObject({ kind: 'lane', cell: 'square' });
    const text = JSON.stringify(snap.view);
    expect(text).not.toContain('"rng"');
    expect(text).not.toContain('"secret"');
    // The opponent's hand is placeholders only.
    const world = snap.view.world as World;
    expect(world.cards.zones.e?.hand?.every((id) => !world.cards.instances[id])).toBe(true);
  });

  it('plays AI sides until it is the human’s decision again', async () => {
    const engine = client();
    await engine.start('fixture', 2);
    const after = await engine.act({ type: 'endTurn', side: 'p' });
    expect(after.deciding).toBe('p');
    expect(after.view.turn.round).toBe(2);
    // The AI's turn shows up in the events, redacted for p.
    expect(after.events.some((e) => e.type === 'TurnEnded' && e.side === 'e')).toBe(true);
  });

  it('lists and plays content-only games through the standard ruleset', async () => {
    const item = (kind: string, id: string, fields: object) => ({ formatVersion: 1, kind, id, name: id, ...fields }) as never;
    const plain: GamePackage<unknown> = {
      manifest: { formatVersion: 1, id: 'plain', name: 'Plain', version: '1.0.0', engine: '^0.0.0' },
      content: [
        item('card', 'zap', { targeting: { kind: 'unit', filter: 'enemy' }, effects: [{ op: 'damage', amount: 3 }] }),
        item('unit', 'hero', { hp: 10 }),
        item('unit', 'dummy', { hp: 10 }),
        item('encounter', 'one', { units: [{ unit: 'hero', side: 'player', pos: '0' }, { unit: 'dummy', side: 'enemy', pos: '3' }] }),
        item('ruleset', 'main', { board: { topology: 'lane', length: 4 }, player: { resources: {}, handSize: 2, deck: ['zap', 'zap', 'zap'] } }),
      ],
    };
    const engine = new EngineClient(localTransport(createEngineHost({ packages: [plain] })));
    expect((await engine.listGames()).map((g) => g.id)).toEqual(['plain']);
    const snap = await engine.start('plain', 1);
    expect(snap.side).toBe('player');
    expect(snap.legal.filter((a) => a.type === 'playCard')).toHaveLength(2);
    expect(snap.catalog.cards['plain:zap']?.text).toBe('Deal 3 damage.');
  });

  it('loads a zipped content package, replacing an earlier import, with assets as URLs', async () => {
    const enc = new TextEncoder();
    const json = (v: object) => enc.encode(`${JSON.stringify(v)}\n`);
    const files = (hp: number) => ({
      'zipped/game.json': json({ formatVersion: 1, id: 'zipped', name: 'Zipped', version: '1.0.0', engine: '^0.0.0' }),
      'zipped/content/cards/zap.json': json({ formatVersion: 1, kind: 'card', id: 'zap', name: 'Zap', art: 'assets/zap.png', targeting: { kind: 'none' }, effects: [] }),
      'zipped/content/units/hero.json': json({ formatVersion: 1, kind: 'unit', id: 'hero', name: 'Hero', hp }),
      'zipped/content/encounters/one.json': json({ formatVersion: 1, kind: 'encounter', id: 'one', name: 'One', units: [{ unit: 'hero', side: 'player', pos: '0' }, { unit: 'hero', side: 'enemy', pos: '2' }] }),
      'zipped/content/rulesets/main.json': json({ formatVersion: 1, kind: 'ruleset', id: 'main', name: 'Main', board: { topology: 'lane', length: 3 }, player: { resources: {}, handSize: 1, deck: ['zap'] } }),
      'zipped/assets/zap.png': new Uint8Array([1, 2, 3]),
    });
    const engine = client();
    const first = await engine.importZip(zipFiles(files(5)));
    expect(first.loaded).toBe('zipped');
    expect(first.games.map((g) => g.id)).toEqual(['fixture', 'zipped']);
    await engine.importZip(zipFiles(files(9)));
    const snap = await engine.start('zipped', 1);
    expect((snap.view.world as World).board.units.player1?.hp).toBe(9);
    expect(snap.catalog.cards['zipped:zap']?.art).toMatch(/^blob:/);
    await expect(engine.importZip(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({ code: 'invalid-package' });
  });

  describe('playtest: loading live files and applying edits (#42)', () => {
    const enc = new TextEncoder();
    const json = (v: object) => enc.encode(`${JSON.stringify(v)}\n`);
    const files = (damage: number, extra: Record<string, Uint8Array> = {}) => ({
      'game.json': json({ formatVersion: 1, id: 'live', name: 'Live', version: '0.1.0', engine: '^0.0.0' }),
      'content/cards/zap.json': json({ formatVersion: 1, kind: 'card', id: 'zap', name: 'Zap', targeting: { kind: 'unit', filter: 'enemy' }, effects: [{ op: 'damage', amount: damage }] }),
      'content/units/hero.json': json({ formatVersion: 1, kind: 'unit', id: 'hero', name: 'Hero', hp: 30 }),
      'content/units/dummy.json': json({ formatVersion: 1, kind: 'unit', id: 'dummy', name: 'Dummy', hp: 40 }),
      'content/encounters/one.json': json({ formatVersion: 1, kind: 'encounter', id: 'one', name: 'One', units: [{ unit: 'hero', side: 'player', pos: '0' }, { unit: 'dummy', side: 'enemy', pos: '3' }] }),
      'content/rulesets/main.json': json({ formatVersion: 1, kind: 'ruleset', id: 'main', name: 'Main', board: { topology: 'lane', length: 4 }, player: { resources: {}, handSize: 3, deck: ['zap', 'zap', 'zap'] } }),
      ...extra,
    });
    const dummyHp = (snap: { view: { world: unknown } }) => (snap.view.world as World).board.units.enemy1?.hp;
    const zap = async (engine: EngineClient) => {
      const snap = await engine.view();
      const action = snap.legal.find((a) => a.type === 'playCard');
      if (!action) throw new Error('no zap to play');
      return engine.act(action);
    };

    it('edits apply to the next action with hot reload', async () => {
      const engine = client();
      expect((await engine.loadFiles(files(5))).loaded).toBe('live');
      await engine.start('live', 1);
      expect(dummyHp(await zap(engine))).toBe(35);
      const reloaded = await engine.reload(files(10), 'hot');
      expect(dummyHp(reloaded)).toBe(35);
      expect(reloaded.notice).toMatch(/continues/);
      expect(dummyHp(await zap(engine))).toBe(25);
    });

    it('replay reload re-runs the action log under the new content', async () => {
      const engine = client();
      await engine.loadFiles(files(5));
      await engine.start('live', 1);
      await zap(engine);
      const reloaded = await engine.reload(files(10), 'replay');
      expect(dummyHp(reloaded)).toBe(30);
      expect(reloaded.notice).toBe('Changes applied: replayed all 1 actions.');
    });

    it('a broken edit is refused and the game keeps going', async () => {
      const engine = client();
      await engine.loadFiles(files(5));
      await engine.start('live', 1);
      await expect(engine.reload(files(-1), 'hot')).rejects.toMatchObject({ code: 'invalid-package' });
      expect(dummyHp(await zap(engine))).toBe(35);
    });

    it('plays a three-encounter run with a reward choice after each win', async () => {
      const encounter = (id: string) =>
        json({ formatVersion: 1, kind: 'encounter', id, name: id, units: [{ unit: 'hero', side: 'player', pos: '0' }, { unit: 'weak', side: 'enemy', pos: '3' }] });
      const runFiles = {
        ...files(5),
        'content/units/weak.json': json({ formatVersion: 1, kind: 'unit', id: 'weak', name: 'Weak', hp: 3 }),
        'content/cards/bolt.json': json({ formatVersion: 1, kind: 'card', id: 'bolt', name: 'Bolt', targeting: { kind: 'unit', filter: 'enemy' }, effects: [{ op: 'damage', amount: 9 }] }),
        'content/encounters/one.json': encounter('one'),
        'content/encounters/two.json': encounter('two'),
        'content/encounters/three.json': encounter('three'),
        'content/rulesets/main.json': json({
          formatVersion: 1,
          kind: 'ruleset',
          id: 'main',
          name: 'Main',
          board: { topology: 'lane', length: 4 },
          player: { resources: {}, handSize: 3, deck: ['zap', 'zap', 'zap'] },
          run: { encounters: ['one', 'two', 'three'], rewards: { pool: ['zap', 'bolt'], choices: 2 } },
        }),
      };
      const engine = client();
      await engine.loadFiles(runFiles);
      let snap = await engine.start('live', 4);
      expect(snap.run).toMatchObject({ stage: 1, total: 3, status: 'playing' });
      snap = await zap(engine);
      expect(snap.run).toMatchObject({ stage: 1, status: 'reward' });
      expect([...(snap.run?.rewards ?? [])].sort()).toEqual(['live:bolt', 'live:zap']);
      await expect(engine.chooseReward('live:nope')).rejects.toMatchObject({ code: 'illegal-action' });

      snap = await engine.chooseReward('live:bolt');
      expect(snap.run).toMatchObject({ stage: 2, total: 3, status: 'playing' });
      const cards = (snap.view.world as World).cards.zones.player as Record<string, string[]>;
      expect(Object.values(cards).flat()).toHaveLength(4);
      expect((await zap(engine)).run?.status).toBe('reward');
      snap = await engine.chooseReward(null);
      expect(snap.run).toMatchObject({ stage: 3, status: 'playing' });
      snap = await zap(engine);
      expect(snap.run).toMatchObject({ stage: 3, total: 3, status: 'won' });
      // Asking for one encounter plays just that one.
      expect((await engine.start('live', 4, { encounter: 'live:two' })).run).toBeUndefined();
    });

    it('debugs: inspects any step, then rewinds five actions and branches', async () => {
      const engine = new EngineClient(localTransport(createEngineHost({ debug: true })));
      await engine.loadFiles(files(5));
      await engine.start('live', 1);
      for (let i = 0; i < 3; i++) await zap(engine);
      await engine.act({ type: 'endTurn', side: 'player' });
      for (let i = 0; i < 2; i++) await zap(engine);

      const now = await engine.debug();
      expect(now.at).toBe(6);
      expect(now.actions.map((a) => a.action.type)).toEqual(['playCard', 'playCard', 'playCard', 'endTurn', 'playCard', 'playCard']);
      expect(now.actions[0]?.events.some((e) => e.type === 'DamageDealt' && e.amount === 5)).toBe(true);
      expect((now.state.world as World).board.units.enemy1?.hp).toBe(15);

      const early = await engine.debug(1);
      expect((early.state.world as World).board.units.enemy1?.hp).toBe(35);
      expect((early.previous?.world as World).board.units.enemy1?.hp).toBe(40);
      // Each side's view: the enemy can't see the player's hand.
      const enemyView = early.views.enemy?.world as World;
      expect(enemyView.cards.zones.player?.hand?.every((id) => !enemyView.cards.instances[id])).toBe(true);
      expect(Object.keys(early.views).sort()).toEqual(['enemy', 'player']);

      // Rewind five actions and choose differently: end the turn instead.
      const branched = await engine.branch(1);
      expect(dummyHp(branched)).toBe(35);
      expect(branched.notice).toMatch(/Rewound to step 1/);
      await engine.act({ type: 'endTurn', side: 'player' });
      expect((await engine.debug()).actions.map((a) => a.action.type)).toEqual(['playCard', 'endTurn']);
      await expect(engine.debug(9)).rejects.toMatchObject({ code: 'illegal-action' });
    });

    it('a player-facing engine refuses to debug', async () => {
      const engine = client();
      await engine.loadFiles(files(5));
      await engine.start('live', 1);
      await expect(engine.debug()).rejects.toMatchObject({ code: 'illegal-action' });
      await expect(engine.branch(0)).rejects.toMatchObject({ code: 'illegal-action' });
    });

    it('undoes the player’s own actions within a turn, but not past a draw, a turn end, or when the game doesn’t allow it', async () => {
      const ruleset = (undo?: string) =>
        json({ formatVersion: 1, kind: 'ruleset', id: 'main', name: 'Main', board: { topology: 'lane', length: 4 }, player: { resources: {}, handSize: 3, deck: ['zap', 'zap', 'insight', 'zap', 'zap'] }, ...(undo && { undo }) });
      const insight = json({ formatVersion: 1, kind: 'card', id: 'insight', name: 'Insight', targeting: { kind: 'none' }, effects: [{ op: 'draw', n: 1 }] });
      const play = async (engine: EngineClient, def: string) => {
        const snap = await engine.view();
        const world = snap.view.world as World;
        const action = snap.legal.find((a) => a.type === 'playCard' && world.cards.instances[a.card as string]?.def === def);
        if (!action) throw new Error(`no ${def} in hand`);
        return engine.act(action);
      };
      const engine = client();
      await engine.loadFiles(files(5, { 'content/rulesets/main.json': ruleset('turn'), 'content/cards/insight.json': insight }));
      // The first seed whose opening hand has Insight and two Zaps.
      let start = await engine.start('live', 1);
      const opening = (snap: typeof start) => Object.values((snap.view.world as World).cards.instances).map((c) => c.def).sort();
      for (let seed = 2; opening(start)[0] !== 'live:insight'; seed++) start = await engine.start('live', seed);
      expect(opening(start)).toEqual(['live:insight', 'live:zap', 'live:zap']);
      expect(start.canUndo).toBe(false);

      const zapped = await play(engine, 'live:zap');
      expect(dummyHp(zapped)).toBe(35);
      expect(zapped.canUndo).toBe(true);
      const undone = await engine.undo();
      expect(undone.view).toEqual(start.view);
      expect(undone.canUndo).toBe(false);
      await expect(engine.undo()).rejects.toMatchObject({ code: 'illegal-action' });

      // Drawing shows a new card: no going back past it.
      await play(engine, 'live:zap');
      expect((await play(engine, 'live:insight')).canUndo).toBe(false);
      expect((await play(engine, 'live:zap')).canUndo).toBe(true);
      expect((await engine.act({ type: 'endTurn', side: 'player' })).canUndo).toBe(false);

      // Without the ruleset's permission there is no undo at all.
      const strict = client();
      await strict.loadFiles(files(5));
      await strict.start('live', 1);
      expect((await zap(strict)).canUndo).toBe(false);
    });

    it('walks a branching run map: fight, choose a path, a spring, then the boss', async () => {
      const encounter = (id: string) =>
        json({ formatVersion: 1, kind: 'encounter', id, name: `Fight ${id}`, units: [{ unit: 'hero', side: 'player', pos: '0' }, { unit: 'weak', side: 'enemy', pos: '3' }] });
      const mapFiles = {
        ...files(5),
        'content/units/weak.json': json({ formatVersion: 1, kind: 'unit', id: 'weak', name: 'Weak', hp: 3 }),
        'content/encounters/one.json': encounter('one'),
        'content/encounters/two.json': encounter('two'),
        'content/encounters/three.json': encounter('three'),
        'content/rulesets/main.json': json({
          formatVersion: 1,
          kind: 'ruleset',
          id: 'main',
          name: 'Main',
          board: { topology: 'lane', length: 4 },
          player: { resources: {}, handSize: 3, deck: ['zap', 'zap', 'zap'] },
          run: {
            map: {
              start: 'a',
              nodes: [
                { id: 'a', kind: 'fight', encounter: 'one', next: ['b', 'c'] },
                { id: 'b', kind: 'spring', next: ['d'] },
                { id: 'c', kind: 'elite', encounter: 'two', next: ['d'] },
                { id: 'd', kind: 'boss', encounter: 'three', next: [] },
              ],
            },
            rewards: { pool: ['zap'], choices: 1 },
          },
        }),
      };
      const engine = client();
      await engine.loadFiles(mapFiles);
      let snap = await engine.start('live', 1);
      expect(snap.run).toMatchObject({ stage: 1, total: 3, status: 'playing' });
      expect(snap.run?.map?.nodes.map((n) => [n.id, n.name, n.depth])).toEqual([
        ['a', 'Fight one', 0],
        ['b', 'Spring', 1],
        ['c', 'Fight two', 1],
        ['d', 'Fight three', 2],
      ]);
      await zap(engine);
      snap = await engine.chooseReward(null);
      expect(snap.run).toMatchObject({ status: 'map', map: { choices: ['b', 'c'], visited: ['a'] } });
      await expect(engine.chooseNode('d')).rejects.toMatchObject({ code: 'illegal-action' });

      snap = await engine.chooseNode('b');
      expect(snap.run).toMatchObject({ stage: 2, status: 'service', service: { kind: 'spring', offer: [] } });
      snap = await engine.chooseService({ action: 'heal' });
      expect(snap.notice).toBe('The spring restores 30% of your HP.');
      expect(snap.run).toMatchObject({ stage: 2, status: 'map', map: { choices: ['d'] } });
      snap = await engine.chooseNode('d');
      expect(snap.run).toMatchObject({ stage: 3, status: 'playing', map: { current: 'd', visited: ['a', 'b', 'd'] } });
      snap = await zap(engine);
      expect(snap.run?.status).toBe('won');
    });

    it('serves unit sprites and the encounter scene as typed object URLs', async () => {
      const svg = enc.encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle r="5"/></svg>');
      const art = {
        ...files(5),
        'content/units/dummy.json': json({ formatVersion: 1, kind: 'unit', id: 'dummy', name: 'Dummy', hp: 40, art: 'assets/units/dummy.svg' }),
        'content/encounters/one.json': json({ formatVersion: 1, kind: 'encounter', id: 'one', name: 'One', background: 'assets/scenes/cave.svg', units: [{ unit: 'hero', side: 'player', pos: '0' }, { unit: 'dummy', side: 'enemy', pos: '3' }] }),
        'assets/units/dummy.svg': svg,
        'assets/scenes/cave.svg': svg,
      };
      const engine = client();
      await engine.loadFiles(art);
      const snap = await engine.start('live', 1);
      expect(snap.catalog.art['live:dummy']).toMatch(/^blob:/);
      expect(snap.catalog.art['live:hero']).toBeUndefined();
      expect(snap.scene?.background).toMatch(/^blob:/);
      const blob = await (await fetch(snap.catalog.art['live:dummy'] as string)).blob();
      expect(blob.type).toBe('image/svg+xml');
    });

    it('a fruiting log upgrades a card or offers a hybrid; a spring removes a card', async () => {
      const encounter = (id: string) => json({ formatVersion: 1, kind: 'encounter', id, name: id, units: [{ unit: 'hero', side: 'player', pos: '0' }, { unit: 'weak', side: 'enemy', pos: '3' }] });
      const runFiles = {
        ...files(5),
        'content/cards/zap.json': json({ formatVersion: 1, kind: 'card', id: 'zap', name: 'Zap', tags: ['zappy'], targeting: { kind: 'unit', filter: 'enemy' }, effects: [{ op: 'damage', amount: 5 }], upgrade: { name: 'Zap+', effects: [{ op: 'damage', amount: 9 }] } }),
        'content/cards/hybrid.json': json({ formatVersion: 1, kind: 'card', id: 'hybrid', name: 'Hybrid', requires: ['zappy'], targeting: { kind: 'none' }, effects: [] }),
        'content/units/weak.json': json({ formatVersion: 1, kind: 'unit', id: 'weak', name: 'Weak', hp: 3 }),
        'content/encounters/one.json': encounter('one'),
        'content/encounters/two.json': encounter('two'),
        'content/rulesets/main.json': json({
          formatVersion: 1,
          kind: 'ruleset',
          id: 'main',
          name: 'Main',
          board: { topology: 'lane', length: 4 },
          player: { resources: {}, handSize: 3, deck: ['zap', 'zap', 'zap'] },
          run: {
            map: {
              start: 'a',
              nodes: [
                { id: 'a', kind: 'fight', encounter: 'one', next: ['f'] },
                { id: 'f', kind: 'fruiting', next: ['s'] },
                { id: 's', kind: 'spring', next: ['b'] },
                { id: 'b', kind: 'boss', encounter: 'two', next: [] },
              ],
            },
            rewards: { pool: ['hybrid'], choices: 1 },
          },
        }),
      };
      const engine = client();
      await engine.loadFiles(runFiles);
      await engine.start('live', 1);
      await zap(engine);
      await engine.chooseReward(null);
      let snap = await engine.chooseNode('f');
      expect(snap.run).toMatchObject({ status: 'service', service: { kind: 'fruiting', offer: ['live:hybrid'] } });
      expect(snap.catalog.cards['live:zap']?.upgrade).toMatchObject({ name: 'Zap+', text: 'Deal 9 damage.' });
      await expect(engine.chooseService({ action: 'heal' })).rejects.toMatchObject({ code: 'illegal-action' });
      snap = await engine.chooseService({ action: 'upgrade', index: 0 });
      expect(snap.notice).toBe('Zap is upgraded.');
      expect(snap.run?.deck).toEqual([{ def: 'live:zap', upgraded: true }, { def: 'live:zap' }, { def: 'live:zap' }]);
      await engine.chooseNode('s');
      snap = await engine.chooseService({ action: 'remove', index: 2 });
      expect(snap.run?.deck).toHaveLength(2);
      snap = await engine.chooseNode('b');
      // The upgraded Zap is upgraded in play.
      const instances = Object.values((snap.view.world as World).cards.instances) as { def: string; upgraded?: boolean }[];
      expect(instances.filter((c) => c.upgraded)).toHaveLength(1);
      expect(instances).toHaveLength(2);
    });

    it('a junction connects a strain, and later rewards come from it', async () => {
      const card = (id: string, tags: string[]) => json({ formatVersion: 1, kind: 'card', id, name: id, targeting: { kind: 'none' }, effects: [], tags });
      const encounter = (id: string) => json({ formatVersion: 1, kind: 'encounter', id, name: id, units: [{ unit: 'hero', side: 'player', pos: '0' }, { unit: 'weak', side: 'enemy', pos: '3' }] });
      const runFiles = {
        ...files(5),
        'content/units/weak.json': json({ formatVersion: 1, kind: 'unit', id: 'weak', name: 'Weak', hp: 3 }),
        'content/cards/rot1.json': card('rot1', ['rot']),
        'content/cards/spore1.json': card('spore1', ['spore']),
        'content/encounters/one.json': encounter('one'),
        'content/encounters/two.json': encounter('two'),
        'content/rulesets/main.json': json({
          formatVersion: 1,
          kind: 'ruleset',
          id: 'main',
          name: 'Main',
          board: { topology: 'lane', length: 4 },
          player: { resources: {}, handSize: 3, deck: ['zap', 'zap', 'zap'] },
          run: {
            strains: ['rot', 'spore'],
            map: {
              start: 'a',
              nodes: [
                { id: 'a', kind: 'fight', encounter: 'one', next: ['j'] },
                { id: 'j', kind: 'junction', next: ['b'] },
                { id: 'b', kind: 'boss', encounter: 'two', next: [] },
              ],
            },
            rewards: { pool: ['rot1', 'spore1'], choices: 3 },
          },
        }),
      };
      const engine = client();
      await engine.loadFiles(runFiles);
      await engine.start('live', 1);
      let snap = await zap(engine);
      // No strain is connected yet, so there is nothing to offer.
      expect(snap.run).toMatchObject({ status: 'reward', rewards: [], offer: 'card', strains: { all: ['rot', 'spore'], unlocked: [] } });
      await engine.chooseReward(null);
      snap = await engine.chooseNode('j');
      expect(snap.run).toMatchObject({ status: 'reward', offer: 'strain' });
      expect([...(snap.run?.rewards ?? [])].sort()).toEqual(['live:rot1', 'live:spore1']);
      snap = await engine.chooseReward('live:spore1');
      expect(snap.run?.strains?.unlocked).toEqual(['spore']);
      await engine.chooseNode('b');
      expect((await zap(engine)).run?.status).toBe('won');
    });

    it('starts a saved scenario', async () => {
      const engine = client();
      const scenario = json({ formatVersion: 1, kind: 'scenario', id: 'opening', name: 'Opening', encounter: 'one', seed: 'x', hand: ['zap'], deck: [] });
      await engine.loadFiles(files(5, { 'content/scenarios/opening.json': scenario }));
      const snap = await engine.start('live', 99, { scenario: 'live:opening' });
      expect((snap.view.world as World).cards.zones.player?.hand).toHaveLength(1);
    });
  });

  it('reports errors instead of throwing', async () => {
    const engine = client();
    await expect(engine.view()).rejects.toMatchObject({ code: 'not-started' });
    await expect(engine.start('nope', 1)).rejects.toMatchObject({ code: 'unknown-game' });
    await engine.start('fixture', 3);
    await expect(engine.act({ type: 'endTurn', side: 'e' })).rejects.toMatchObject({ code: 'illegal-action' });
    await expect(engine.act({ type: 'playCard', side: 'p', card: 'nope' })).rejects.toMatchObject({ code: 'illegal-action' });
  });

  it('works across a worker-style message channel', async () => {
    type Listener = (event: { data: unknown }) => void;
    const channel = () => {
      const listeners: Listener[] = [];
      return { listeners, port: { addEventListener: (_t: 'message', l: Listener) => listeners.push(l) } };
    };
    const toWorker = channel();
    const toPage = channel();
    const deliver = (listeners: Listener[], data: unknown) => queueMicrotask(() => listeners.forEach((l) => l({ data: structuredClone(data) })));
    serveEngine(createEngineHost({ packages: [fixture() as GamePackage<unknown>] }), {
      ...toWorker.port,
      postMessage: (data) => deliver(toPage.listeners, data),
    });
    const engine = new EngineClient(workerTransport({ ...toPage.port, postMessage: (data) => deliver(toWorker.listeners, data) }));
    expect((await engine.listGames()).map((g) => g.id)).toEqual(['fixture']);
    expect((await engine.start('fixture', 4)).deciding).toBe('p');
  });
});

describe('hidden information in the example game (#59)', () => {
  const root = fileURLToPath(new URL('../../../examples/duel', import.meta.url));
  const files = () => {
    const out: Record<string, Uint8Array> = {};
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else out[relative(root, path).split(sep).join('/')] = new Uint8Array(readFileSync(path));
      }
    };
    walk(root);
    return out;
  };

  it('fog keeps out-of-sight units out of everything the player receives', async () => {
    const engine = new EngineClient(localTransport(createEngineHost({ files: [files()] })));
    const snap = await engine.start('duel', 3, { encounter: 'duel:first-fight' });
    const world = snap.view.world as World & { board: { vision?: string[] } };
    expect(Object.values(world.board.units).map((u) => u.def)).toEqual(['duel:hero']);
    expect(world.board.vision).toEqual(['0', '1', '2', '3', '4']);
    const text = JSON.stringify(snap);
    expect(text).not.toContain('"secret"');
    expect(text).not.toContain('"rng"');
    expect(text).not.toContain('enemy1');
  });

  it('a trap placed face-down shows only to its owner', async () => {
    const engine = new EngineClient(localTransport(createEngineHost({ files: [files()], debug: true })));
    const snap = await engine.start('duel', 3, { encounter: 'duel:first-fight' });
    const world = snap.view.world as World;
    const snare = snap.legal.find((a) => a.type === 'playCard' && world.cards.instances[a.card as string]?.def === 'duel:snare' && a.target === '3');
    if (!snare) throw new Error('no snare to place on 3');
    const after = await engine.act(snare);
    expect(Object.values((after.view.world as World).board.units).some((u) => u.def === 'duel:snare-trap')).toBe(true);
    const debug = await engine.debug();
    const enemy = JSON.stringify(debug.views.enemy);
    expect(enemy).not.toContain('snare');
    expect(Object.keys((debug.views.enemy?.world as { permanents: object }).permanents)).toEqual([]);
    expect(Object.keys((debug.views.player?.world as { permanents: object }).permanents)).toHaveLength(1);
  });
});

describe('settings', () => {
  it('stores typed values through any key-value storage', async () => {
    const storage = memoryStorage();
    const settings = new SettingsStore(storage);
    expect(await settings.get('volume', 0.5)).toBe(0.5);
    await settings.set('volume', 0.8);
    expect(await settings.get('volume', 0.5)).toBe(0.8);
    expect(await storage.keys('settings:')).toEqual(['settings:volume']);
  });
});
