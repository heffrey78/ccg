/**
 * A small 1D lane game used to exercise the kernel against the worked examples
 * in docs/design/resolution-order.md. It stands in for the real card, board,
 * unit and status modules (#21, #23, #24), which will re-encode the examples
 * with production ops.
 */
import {
  createGame,
  type ActionDef,
  type Effect,
  type EffectContext,
  type GameRules,
  type GameState,
  type Listener,
  type SideId,
  type StateCheck,
  type Step,
} from '../src/index.js';

export const PLAYER = 'p';
export const ENEMY = 'e';

export interface Unit {
  id: string;
  side: SideId;
  pos: number;
  hp: number;
  baseMaxHp: number;
  maxHp: number;
  block: number;
  createdAt: number;
  dead?: boolean;
  /** Reactive trigger effects run after this unit dies. */
  onDeath?: Effect[];
  /** Static aura: +bonus max HP to same-side units within radius. */
  aura?: { bonus: number; radius: number };
}

export type SideStatus = 'opportunist' | 'grit' | 'thorns' | 'mirror';

export interface LaneWorld {
  length: number;
  walls: number[];
  /** Position (as a string key) → damage dealt to a unit entering it. */
  hazards: Record<string, number>;
  collision: 'stop' | 'bump' | 'chain';
  units: Record<string, Unit>;
  statuses: { side: SideId; status: SideStatus; createdAt: number }[];
  cards: Record<string, Effect[]>;
  hand: string[];
  deck: string[];
  discard: string[];
  resolving: string[];
  energy: number;
  /** Items the enemy announces when its phase starts. */
  enemyPlan: Effect[][];
}

export type LaneState = GameState<LaneWorld>;

export function unit(id: string, side: SideId, pos: number, hp: number, extra: Partial<Unit> = {}): Unit {
  return { id, side, pos, hp, baseMaxHp: hp, maxHp: hp, block: 0, createdAt: 0, ...extra };
}

export function world(overrides: Partial<LaneWorld>): LaneWorld {
  return {
    length: 8,
    walls: [],
    hazards: {},
    collision: 'bump',
    units: {},
    statuses: [],
    cards: {},
    hand: [],
    deck: [],
    discard: [],
    resolving: [],
    energy: 0,
    enemyPlan: [],
    ...overrides,
  };
}

const living = (state: LaneState) => Object.values(state.world.units).filter((u) => !u.dead);
const unitAt = (state: LaneState, pos: number) => living(state).find((u) => u.pos === pos);
const exists = (state: LaneState, id: string) => {
  const u = state.world.units[id];
  return u !== undefined && !u.dead;
};
const str = (value: unknown) => value as string;
const num = (value: unknown) => value as number;

// ---- ops ----

function damage(ctx: EffectContext<LaneWorld>, p: Record<string, unknown>) {
  const targets = Array.isArray(p.target) ? (p.target as string[]) : [str(p.target)];
  const amount = num(p.amount) * (p.times === undefined ? 1 : num(p.times));
  ctx.step(
    targets
      .filter((id) => exists(ctx.state, id))
      .map((id) => ({ kind: 'damage', unit: id, amount, source: p.source ?? 'card' })),
  );
}

function push(ctx: EffectContext<LaneWorld>, p: Record<string, unknown>) {
  const id = str(p.unit);
  const dir = num(p.dir ?? 1);
  for (let i = 0; i < num(p.distance); i++) {
    const mover = ctx.state.world.units[id];
    if (!mover || mover.dead) return;
    const next = mover.pos + dir;
    const w = ctx.state.world;
    const wall = next < 0 || next >= w.length || w.walls.includes(next);
    const blocker = unitAt(ctx.state, next);
    if (!wall && !blocker) {
      if (ctx.step({ kind: 'move', unit: id, to: next }).halted) return;
      continue;
    }
    if (w.collision === 'stop') return;
    if (w.collision === 'chain' && blocker) {
      // Find the front of the line; if the tile beyond it is free, shuffle the
      // line forward front-first, then the mover steps.
      const line = [blocker];
      let front = next + dir;
      for (let u = unitAt(ctx.state, front); u; u = unitAt(ctx.state, front)) {
        line.push(u);
        front += dir;
      }
      const frontBlocked = front < 0 || front >= w.length || w.walls.includes(front);
      if (!frontBlocked) {
        for (const u of line.reverse()) ctx.step({ kind: 'move', unit: u.id, to: u.pos + dir });
        if (ctx.step({ kind: 'move', unit: id, to: next }).halted) return;
        continue;
      }
    }
    const hits: Step[] = [{ kind: 'damage', unit: id, amount: 1, source: 'collision' }];
    if (blocker) hits.push({ kind: 'damage', unit: blocker.id, amount: 1, source: 'collision' });
    ctx.step(hits);
    return;
  }
}

function adjacent(ctx: EffectContext<LaneWorld>, pos: number) {
  return living(ctx.state).filter((u) => Math.abs(u.pos - pos) === 1);
}

export const laneRules: GameRules<LaneWorld> = {
  round: [
    { id: 'main', side: PLAYER, interactive: true },
    {
      id: 'enemy',
      side: ENEMY,
      enter(ctx) {
        for (const effects of ctx.state.world.enemyPlan.slice().reverse()) {
          ctx.announce({ kind: 'intent', controller: ENEMY, source: null, effects, vars: {} });
        }
      },
    },
  ],

  ops: {
    damage,
    push,
    draw(ctx, p) {
      for (let i = 0; i < num(p.n); i++) ctx.step({ kind: 'draw' });
    },
    gainEnergy(ctx, p) {
      ctx.step({ kind: 'energy', amount: num(p.amount) });
    },
    attack(ctx, p) {
      if (!exists(ctx.state, str(p.target))) return;
      ctx.step({ kind: 'damage', unit: p.target, amount: p.amount, source: 'attack' });
      ctx.step({ kind: 'attackResolved', attacker: p.attacker, target: p.target });
    },
    damageAdjacent(ctx, p) {
      ctx.step(adjacent(ctx, num(p.pos)).map((u) => ({ kind: 'damage', unit: u.id, amount: p.amount, source: 'card' })));
    },
    healAdjacentAllies(ctx, p) {
      const allies = adjacent(ctx, num(p.pos)).filter((u) => u.side === p.side);
      ctx.step(allies.map((u) => ({ kind: 'heal', unit: u.id, amount: p.amount })));
    },
    damageRandomEnemyOf(ctx, p) {
      const foes = living(ctx.state)
        .filter((u) => u.side !== p.side)
        .sort((a, b) => a.pos - b.pos);
      if (foes.length > 0) {
        ctx.step({ kind: 'damage', unit: ctx.rng.pick(foes).id, amount: p.amount, source: 'card' });
      }
    },
    destroy(ctx, p) {
      const target = ctx.state.world.units[str(p.target)];
      if (!target || target.dead) return;
      ctx.setVar('destroyed', { pos: target.pos });
      ctx.step({ kind: 'remove', unit: target.id, reason: 'destroyed' });
    },
    discardHand(ctx) {
      const cards = ctx.state.world.hand.slice();
      ctx.step(cards.map((card) => ({ kind: 'discard', card })));
      ctx.setVar('discarded', { count: cards.length });
    },
    damageByHandSize(ctx, p) {
      const times = ctx.state.world.hand.length;
      ctx.step({ kind: 'damage', unit: p.target, amount: num(p.per) * times, source: 'card' });
    },
  },

  steps: {
    damage(state, s) {
      const u = state.world.units[str(s.unit)];
      if (!u || u.dead) return [];
      const amount = num(s.amount);
      if (amount <= 0) return [{ type: 'AttackBlocked', unit: u.id }];
      u.hp -= amount;
      return [{ type: 'DamageDealt', unit: u.id, side: u.side, amount, source: s.source }];
    },
    loseBlock(state, s) {
      const u = state.world.units[str(s.unit)] as Unit;
      u.block -= num(s.amount);
      return [{ type: 'BlockLost', unit: u.id, amount: s.amount }];
    },
    heal(state, s) {
      const u = state.world.units[str(s.unit)] as Unit;
      const before = u.hp;
      u.hp = Math.min(u.maxHp, u.hp + num(s.amount));
      return [{ type: 'Healed', unit: u.id, amount: u.hp - before }];
    },
    move(state, s) {
      const u = state.world.units[str(s.unit)] as Unit;
      const from = u.pos;
      u.pos = num(s.to);
      return [
        { type: 'UnitLeftTile', unit: u.id, pos: from },
        { type: 'UnitEnteredTile', unit: u.id, pos: u.pos },
      ];
    },
    draw(state) {
      const card = state.world.deck.shift();
      if (card === undefined) return [];
      state.world.hand.push(card);
      return [{ type: 'CardDrawn', card }];
    },
    discard(state, s) {
      const hand = state.world.hand;
      hand.splice(hand.indexOf(str(s.card)), 1);
      state.world.discard.push(str(s.card));
      return [{ type: 'CardDiscarded', card: s.card }];
    },
    energy(state, s) {
      state.world.energy += num(s.amount);
      return [{ type: 'EnergyGained', amount: s.amount }];
    },
    attackResolved(_state, s) {
      return [{ type: 'AttackResolved', attacker: s.attacker, target: s.target }];
    },
    // The unit stays in play for this event so its own death triggers match;
    // the deaths check removes it with a separate step (§4 step 4).
    die(state, s) {
      const u = state.world.units[str(s.unit)] as Unit;
      return [{ type: 'UnitDied', unit: u.id, side: u.side, pos: u.pos }];
    },
    remove(state, s) {
      const u = state.world.units[str(s.unit)] as Unit;
      // Removed units keep their record (marked dead) so tests can inspect it.
      u.dead = true;
      return [{ type: 'UnitLeftPlay', unit: u.id, pos: u.pos, reason: s.reason }];
    },
  },

  actions: {
    play: {
      list: (state, side) =>
        side === PLAYER ? [...new Set(state.world.hand)].map((card) => ({ type: 'play', side, card })) : [],
      perform(ctx, action) {
        const w = ctx.state.world;
        const card = str(action.card);
        w.hand.splice(w.hand.indexOf(card), 1);
        w.resolving.push(card);
        ctx.announce({
          kind: 'card',
          controller: action.side,
          source: card,
          effects: w.cards[card] ?? [],
          // `bind: "onPlay"` snapshot (§3.1): taken after the card left the hand.
          vars: { handAtPlay: w.hand.length },
        });
      },
    } satisfies ActionDef<LaneWorld>,
  },

  onItemResolved(ctx, item) {
    if (item.kind !== 'card') return;
    const w = ctx.state.world;
    const card = str(item.source);
    w.resolving.splice(w.resolving.indexOf(card), 1);
    w.discard.push(card);
  },

  listeners(state) {
    const out: Listener<LaneWorld>[] = [];
    const w = state.world;

    for (const [key, amount] of Object.entries(w.hazards)) {
      const pos = Number(key);
      out.push({
        kind: 'interrupt',
        id: `hazard@${pos}`,
        source: null,
        controller: null,
        layer: 'rules',
        timestamp: 0,
        matches: (e) => e.type === 'UnitEnteredTile' && e.pos === pos,
        effects: [{ op: 'damage', target: { $: 'event.unit' }, amount, source: 'terrain' }],
      });
    }

    for (const u of living(state)) {
      if (u.block > 0) {
        out.push({
          kind: 'modifier',
          id: `block:${u.id}`,
          source: u.id,
          controller: u.side,
          layer: 'innate',
          timestamp: u.createdAt,
          matches: (s) => s.kind === 'damage' && s.unit === u.id && num(s.amount) > 0,
          modify(s, st) {
            const current = st.world.units[u.id] as Unit;
            const absorbed = Math.min(current.block, num(s.amount));
            return [
              { kind: 'loseBlock', unit: u.id, amount: absorbed },
              { ...s, amount: num(s.amount) - absorbed },
            ];
          },
        });
      }
      if (u.onDeath) {
        out.push({
          kind: 'trigger',
          id: `onDeath:${u.id}`,
          source: u.id,
          controller: u.side,
          layer: 'innate',
          timestamp: u.createdAt,
          matches: (e) => e.type === 'UnitDied' && e.unit === u.id,
          effects: u.onDeath,
        });
      }
    }

    for (const { side, status, createdAt } of w.statuses) {
      const base = { id: `${status}:${side}`, source: null, controller: side, layer: 'status' as const, timestamp: createdAt };
      const unitSide = (e: { unit?: unknown }) => w.units[str(e.unit)]?.side;
      switch (status) {
        case 'opportunist':
          out.push({
            ...base,
            kind: 'trigger',
            matches: (e) => e.type === 'DamageDealt' && e.source === 'terrain' && e.side !== side,
            effects: [{ op: 'draw', n: 1 }],
          });
          break;
        case 'grit':
          out.push({
            ...base,
            kind: 'trigger',
            matches: (e) => e.type === 'DamageDealt' && e.side === side,
            effects: [{ op: 'gainEnergy', amount: 1 }],
          });
          break;
        case 'thorns':
          out.push({
            ...base,
            kind: 'trigger',
            matches: (e) => e.type === 'AttackResolved' && unitSide({ unit: e.target }) === side,
            effects: [{ op: 'damage', target: { $: 'event.attacker' }, amount: 1, source: 'thorns' }],
          });
          break;
        case 'mirror':
          out.push({
            ...base,
            kind: 'trigger',
            matches: (e) => e.type === 'DamageDealt' && e.side !== side,
            effects: [{ op: 'damageRandomEnemyOf', side, amount: 1 }],
          });
          break;
      }
    }
    return out;
  },

  stateChecks: [
    // Statics: recompute max HP from auras (§9.3).
    ((ctx) => {
      let changed = false;
      const units = living(ctx.state);
      for (const u of units) {
        const bonus = units
          .filter((src) => src.aura && src.id !== u.id && src.side === u.side)
          .filter((src) => Math.abs(src.pos - u.pos) <= (src.aura?.radius ?? 0))
          .reduce((sum, src) => sum + (src.aura?.bonus ?? 0), 0);
        if (u.maxHp !== u.baseMaxHp + bonus) {
          u.maxHp = u.baseMaxHp + bonus;
          changed = true;
        }
      }
      return changed;
    }) satisfies StateCheck<LaneWorld>,
    // Clamp current HP to max HP.
    (ctx) => {
      let changed = false;
      for (const u of living(ctx.state)) {
        if (u.hp > u.maxHp) {
          u.hp = u.maxHp;
          changed = true;
        }
      }
      return changed;
    },
    // Deaths: all at once in board order, then they leave play (§4 step 4).
    (ctx) => {
      const dying = living(ctx.state)
        .filter((u) => u.hp <= 0)
        .sort((a, b) => a.pos - b.pos);
      if (dying.length === 0) return false;
      ctx.step(dying.map((u) => ({ kind: 'die', unit: u.id })));
      ctx.step(dying.map((u) => ({ kind: 'remove', unit: u.id, reason: 'died' })));
      return true;
    },
  ],

  outcome(state) {
    const sides = new Set(living(state).map((u) => u.side));
    if (!sides.has(PLAYER)) return { winners: [ENEMY], reason: 'player defeated' };
    return null;
  },
};

export function startLane(w: LaneWorld, seed: string | number = 'lane'): LaneState {
  const result = createGame(laneRules, {
    seed,
    sides: [
      { id: PLAYER, controller: 'human' },
      { id: ENEMY, controller: 'ai' },
    ],
    world: w,
  });
  if (!result.ok) throw new Error(`createGame failed: ${result.error.message}`);
  return result.state;
}
