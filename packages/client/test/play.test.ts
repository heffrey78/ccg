import { describe, expect, it } from 'vitest';
import { HexTopology, LaneTopology, type Action, type GameEvent } from '@ccg/core';
import { Playback, beats, unitsAfter, type PlaybackState, type Timer } from '../src/ui/play/playback.js';
import { anchorCell, choicesFor, offers } from '../src/ui/play/selection.js';
import type { Layout, UnitView, WorldView } from '../src/ui/play/world.js';

const unit = (id: string, side: string, pos: string, extra: Partial<UnitView> = {}): UnitView => ({
  id,
  def: `d:${id}`,
  side,
  pos,
  facing: 'e',
  hp: 10,
  maxHp: 10,
  block: 0,
  statuses: {},
  ...extra,
});
const layout = (topology: { layout(): Omit<Layout, 'tiles'> }): Layout => ({ ...topology.layout(), tiles: {} });

describe('choices and anchors', () => {
  const world: WorldView = { board: { units: { P: unit('P', 'p', '1', { createdAt: 1 }), E: unit('E', 'e', '3') }, tiles: {} } };
  const lane = layout(new LaneTopology(5));
  const legal: Action[] = [
    { type: 'playCard', side: 'p', card: 'c1', target: 'E' },
    { type: 'playCard', side: 'p', card: 'c2', target: 'e' },
    { type: 'playCard', side: 'p', card: 'c2', target: 'w' },
    { type: 'playCard', side: 'p', card: 'c3' },
    { type: 'move', side: 'p', unit: 'P', to: '2' },
    { type: 'endTurn', side: 'p' },
  ];
  const o = offers(legal);

  it('groups legal actions by what the player clicks', () => {
    expect([...o.cards.keys()]).toEqual(['c1', 'c2', 'c3']);
    expect(o.units.get('P')).toHaveLength(1);
    expect(o.endTurn).toEqual({ type: 'endTurn', side: 'p' });
    expect(o.pass).toBeNull();
  });

  it('anchors unit, direction, tile and untargeted choices on the board', () => {
    const cells = (card: string) =>
      choicesFor({ kind: 'card', card }, o, world, lane, 'p').map((c) => [c.anchor.kind, anchorCell(c.anchor, world.board, lane)]);
    expect(cells('c1')).toEqual([['unit', '3']]);
    // Directions are drawn one step from the acting unit.
    expect(cells('c2')).toEqual([
      ['direction', '2'],
      ['direction', '0'],
    ]);
    expect(cells('c3')).toEqual([['none', null]]);
    expect(choicesFor({ kind: 'unit', unit: 'P' }, o, world, lane, 'p').map((c) => c.anchor)).toEqual([{ kind: 'tile', pos: '2' }]);
  });

  it('finds the neighbouring hex for a direction', () => {
    const hex = layout(HexTopology.hexagon(1));
    const anchor = { kind: 'direction', dir: 'se', from: '0,0' } as const;
    expect(anchorCell(anchor, undefined, hex)).toBe('0,1');
    expect(anchorCell({ ...anchor, from: '0,1' }, undefined, hex)).toBeNull();
  });
});

describe('event playback', () => {
  const ev = (type: string, fields: Record<string, unknown> = {}): GameEvent => ({ type, cause: { action: 0 }, ...fields });
  const events: GameEvent[] = [
    ev('ItemAnnounced', { item: 'i1', kind: 'intent', source: 'E' }),
    ev('PriorityGiven', { side: 'p' }),
    ev('UnitEnteredTile', { unit: 'E', pos: '2', from: '3' }),
    ev('DamageDealt', { unit: 'P', amount: 4 }),
    ev('StatusChanged', { unit: 'P', status: 'burn', stacks: 2, delta: 2 }),
    ev('UnitDied', { unit: 'E' }),
  ];

  /** A timer driven by hand. */
  const manual = () => {
    const queue: { fn: () => void; ms: number }[] = [];
    const timer: Timer = { set: (fn, ms) => queue.push({ fn, ms }), clear: () => queue.splice(0) };
    return { timer, queue, fire: () => queue.shift()?.fn() };
  };

  it('keeps only animated events and scales durations by speed', () => {
    const at1 = beats(events, 1);
    expect(at1.map((b) => b.event.type)).toEqual(['ItemAnnounced', 'UnitEnteredTile', 'DamageDealt', 'StatusChanged', 'UnitDied']);
    expect(beats(events, 2).map((b) => b.duration)).toEqual(at1.map((b) => b.duration / 2));
    expect(beats(events, 0)).toEqual([]);
  });

  it('plays beats in order, one per timer tick, then finishes', () => {
    const t = manual();
    const seen: PlaybackState[] = [];
    const playback = new Playback((s) => seen.push(s), t.timer);
    playback.play(events, 1);
    expect(playback.state).toMatchObject({ shown: 1, done: false });
    expect(t.queue[0]?.ms).toBe(beats(events, 1)[0]?.duration);
    const order: string[] = [];
    while (!playback.state.done) {
      order.push(playback.state.beats[playback.state.shown - 1]?.event.type as string);
      t.fire();
    }
    expect(order).toEqual(['ItemAnnounced', 'UnitEnteredTile', 'DamageDealt', 'StatusChanged', 'UnitDied']);
    expect(seen.at(-1)).toMatchObject({ shown: 5, done: true });
  });

  it('skip jumps straight to the end and cancels the pending beat', () => {
    const t = manual();
    const playback = new Playback(() => {}, t.timer);
    playback.play(events, 1);
    t.fire();
    playback.skip();
    expect(playback.state).toMatchObject({ shown: 5, done: true });
    expect(t.queue).toHaveLength(0);
  });

  it('with nothing to animate (or speed 0), playback is done at once', () => {
    const playback = new Playback(() => {}, manual().timer);
    playback.play([ev('PriorityGiven', { side: 'p' })], 1);
    expect(playback.state.done).toBe(true);
    playback.play(events, 0);
    expect(playback.state.done).toBe(true);
  });

  it('applies events to the starting units step by step', () => {
    const start = { P: unit('P', 'p', '1'), E: unit('E', 'e', '3') };
    const final = { P: unit('P', 'p', '1', { hp: 6, statuses: { burn: 2 } }) };
    const mid = unitsAfter(start, events.slice(0, 3), final);
    expect([mid.E?.pos, mid.P?.hp]).toEqual(['2', 10]);
    const end = unitsAfter(start, events, final);
    expect(end.P).toMatchObject({ hp: 6, statuses: { burn: 2 } });
    expect(end.E).toMatchObject({ pos: '2', dying: true });
    // The starting units are not changed.
    expect(start.E.pos).toBe('3');
  });
});
