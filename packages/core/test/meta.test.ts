import { describe, expect, it } from 'vitest';
import type { ContentItem } from '@ccg/content';
import {
  HexTopology,
  PackageRegistry,
  apply,
  applyMeta,
  createGame,
  decidingSide,
  encounterResult,
  hashState,
  launchOptions,
  legalActions,
  randomPolicy,
  replayCampaign,
  resolveEncounter,
  rulesetOf,
  startMeta,
  strategicMap,
  type Action,
  type CampaignEntry,
  type GameState,
  type MetaState,
  type ResolvedGame,
  type StrategicAction,
  type StrategicWorld,
  type BoardWorld,
} from '../src/index.js';

const item = (kind: ContentItem['kind'], id: string, fields: object) => ({ formatVersion: 1, kind, id, name: id, ...fields }) as ContentItem;

/** A tiny content-only game: a hero who blasts a defender, in two kinds of fight. */
function game(): ResolvedGame<unknown> {
  const registry = new PackageRegistry();
  registry.register({
    manifest: { formatVersion: 1, id: 'war', name: 'War', version: '1.0.0', engine: '^0.0.0' },
    content: [
      item('card', 'blast', { cost: { energy: 1 }, targeting: { kind: 'unit', filter: 'enemy' }, effects: [{ op: 'damage', amount: 4 }] }),
      item('card', 'mend', { cost: { energy: 1 }, targeting: { kind: 'self' }, effects: [{ op: 'heal', amount: 2 }] }),
      item('unit', 'hero', { hp: 20 }),
      item('unit', 'militia', {
        hp: 6,
        behavior: { kind: 'intent', intent: { name: 'Jab', target: { kind: 'unit', select: 'nearestEnemy' }, effects: [{ op: 'damage', amount: 3 }] } },
      }),
      item('encounter', 'skirmish', { units: [{ unit: 'hero', side: 'player', pos: '0' }, { unit: 'militia', side: 'enemy', pos: '2' }] }),
      item('encounter', 'siege', {
        units: [
          { unit: 'hero', side: 'player', pos: '0' },
          { unit: 'militia', side: 'enemy', pos: '2' },
          { unit: 'militia', side: 'enemy', pos: '3' },
        ],
      }),
      item('ruleset', 'main', { board: { topology: 'lane', length: 5 }, player: { resources: { energy: 2 }, handSize: 3, deck: ['blast', 'blast', 'blast'] } }),
    ],
  });
  const resolved = registry.resolve('war');
  if (!resolved.ok) throw new Error(resolved.issues.map((i) => i.message).join('\n'));
  return resolved.game;
}

/** Plays a launched encounter: blast while possible, else end the turn. Returns the actions taken. */
function playEncounter(g: ResolvedGame<unknown>, state: MetaState<StrategicWorld>): { actions: Action[]; final: GameState<BoardWorld> } {
  const rules = g.createRules();
  const created = createGame(rules, g.createSetup(launchOptions(state.pending!)));
  if (!created.ok) throw new Error(created.error.message);
  let s = created.state;
  const ai = randomPolicy<unknown>('ai');
  const actions: Action[] = [];
  for (let n = 0; !s.outcome && n < 200; n++) {
    const side = decidingSide(rules, s);
    if (side === null) break;
    const legal = legalActions(rules, s, side);
    const action = side === 'player' ? (legal.find((a) => a.type === 'playCard') ?? legal.find((a) => a.type === 'endTurn') ?? (legal[0] as Action)) : ai.choose(rules, s, side, legal);
    const next = apply(rules, s, action);
    if (!next.ok) throw new Error(next.error.message);
    actions.push(action);
    s = next.state;
  }
  return { actions, final: s as GameState<BoardWorld> };
}

describe('the meta layer: a strategic map launching encounters (#32)', () => {
  const topology = HexTopology.hexagon(1);
  const [home, ...rest] = topology.positions();
  const world = (): StrategicWorld => ({
    regions: Object.fromEntries([
      [home as string, { owner: 'player', income: 2, encounter: 'war:skirmish' }],
      ...rest.map((pos, i) => [pos, { owner: i === 0 ? null : 'enemy', income: i + 1, encounter: i % 2 === 0 ? 'war:skirmish' : 'war:siege' }]),
    ]),
    gold: 0,
    deck: [{ def: 'war:blast' }, { def: 'war:blast' }, { def: 'war:blast' }],
    hp: {},
    market: { 'war:mend': 3 },
    turn: 0,
  });

  it('a turn on the map launches an encounter, its result takes the region, and the whole campaign replays exactly', () => {
    const g = game();
    const rules = strategicMap(topology);
    const start = startMeta('campaign-1', world());
    let state = start;
    const entries: CampaignEntry<StrategicAction>[] = [];
    const hashes: string[] = [];
    const meta = (action: StrategicAction) => {
      const next = applyMeta(rules, state, action);
      if (!next.ok) throw new Error(next.error);
      state = next.state;
      entries.push({ meta: action });
      hashes.push(hashState(state));
      return next.events;
    };

    // Only regions next to home can be attacked.
    const attackable = rules.legal(state).filter((a) => a.type === 'attack').map((a) => (a as { region: string }).region);
    expect(attackable.sort()).toEqual([...topology.neighbors(home as string)].sort());

    const target = attackable[0] as string;
    expect(meta({ type: 'attack', region: target })).toContainEqual({ type: 'EncounterLaunched', encounter: state.pending?.encounter });
    expect(state.pending).toMatchObject({ deck: world().deck, context: { region: target } });
    expect(state.pending?.seed).toMatch(/^enc:\d+$/);
    // While the fight is on, the map waits.
    expect(applyMeta(rules, state, { type: 'endTurn' })).toEqual({ ok: false, error: 'an encounter is being played' });

    const { actions, final } = playEncounter(g, state);
    expect(final.outcome?.winners).toEqual(['player']);
    const resolved = resolveEncounter(rules as never, state, encounterResult(rulesetOf(g), final));
    if (!resolved.ok) throw new Error(resolved.error);
    state = resolved.state as MetaState<StrategicWorld>;
    entries.push({ encounter: actions });
    hashes.push(hashState(state));
    expect(resolved.events).toEqual([{ type: 'RegionTaken', region: target }]);
    expect(state.world.regions[target]?.owner).toBe('player');
    expect(state.world.hp['war:hero']).toBeGreaterThan(0);

    // The economy: income from both regions, then a card bought with it.
    meta({ type: 'endTurn' });
    expect(state.world.gold).toBe(2 + (state.world.regions[target]?.income ?? 0));
    meta({ type: 'recruit', card: 'war:mend' });
    expect(state.world.deck.map((c) => c.def)).toContain('war:mend');

    // The log alone rebuilds the campaign, step for step.
    const replayed = replayCampaign(rules, g, { start, entries });
    if (!replayed.ok) throw new Error(replayed.error);
    expect(replayed.hashes).toEqual(hashes);
    expect(hashState(replayed.state)).toBe(hashState(state));
  });

  it('refuses illegal moves, and ends when every region is taken', () => {
    const rules = strategicMap(topology);
    const state = startMeta('x', world());
    const far = rest.find((pos) => !topology.neighbors(home as string).includes(pos));
    if (far) expect(applyMeta(rules, state, { type: 'attack', region: far }).ok).toBe(false);
    expect(applyMeta(rules, state, { type: 'recruit', card: 'war:mend' }).ok).toBe(false);
    const allMine = startMeta('y', { ...world(), regions: Object.fromEntries(Object.entries(world().regions).map(([p, r]) => [p, { ...r, owner: 'player' as const }])) });
    const ended = applyMeta(rules, allMine, { type: 'endTurn' });
    expect(ended.ok && ended.state.outcome).toEqual({ won: true, reason: 'every region is yours' });
  });
});
