import { describe, expect, it } from 'vitest';
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
