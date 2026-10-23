/**
 * Units on the board, tiles and movement (#23, requirement #3), following
 * resolution-order §4 (deaths), §11 (movement) and decision #13.
 *
 * World slice: `board`. The topology, tile definitions and unit definitions
 * are static and passed to the module.
 */
import { ContentError } from '../kernel/params.js';
import type {
  ActionDef,
  Effect,
  EffectContext,
  EventInput,
  GameState,
  Listener,
  SideId,
  Step,
} from '../kernel/types.js';
import type { RulesModule } from '../rules/compose.js';
import { findPath, type Dir, type Pos, type Topology } from './topology.js';

export interface UnitState {
  id: string;
  /** Content id of the unit definition. */
  def: string;
  side: SideId;
  pos: Pos;
  facing: Dir;
  hp: number;
  maxHp: number;
  block: number;
  /** Status id → stacks. */
  statuses: Record<string, number>;
  /** When the unit entered play; orders its listeners (§6.3). */
  createdAt: number;
  /** Turn key (`round:side`) of the unit's last basic move. */
  movedOn?: string;
}

export interface BoardState {
  units: Record<string, UnitState>;
  /** Position → tile definition id, for tiles that differ from open ground. */
  tiles: Record<Pos, string>;
}

export interface BoardWorld {
  board: BoardState;
}

export interface TileDef {
  blocking?: boolean;
  /** Effects applied to a unit entering the tile, as an interrupt (§6.1). `event.unit` is the unit. */
  onEnter?: Effect[];
}

export interface UnitDef {
  hp: number;
  statuses?: Record<string, number>;
}

export interface MoveActionConfig {
  /** Maximum path length for one basic move. */
  range: number;
  cost?: Record<string, number>;
  /** Allow one basic move per unit per turn (default true). */
  oncePerTurn?: boolean;
}

export interface BoardConfig {
  topology: Topology;
  tiles?: Record<string, TileDef>;
  units?: Record<string, UnitDef>;
  /** What a forced move does when it hits something (§11). Default `bump`. */
  collision?: 'stop' | 'bump' | 'chain';
  bumpDamage?: number;
  /** Pushing off the board edge: treat it as a wall (default) or the unit falls and dies. */
  edge?: 'wall' | 'fall';
  /** Enables the basic `move` action, separate from cards. */
  moveAction?: MoveActionConfig;
}

export interface UnitPlacement {
  id: string;
  def: string;
  side: SideId;
  pos: Pos;
  facing: Dir;
  hp?: number;
}

/** Builds starting board state. Unit HP comes from its definition unless overridden. */
export function createBoardState(
  units: Record<string, UnitDef>,
  placements: UnitPlacement[],
  tiles: Record<Pos, string> = {},
): BoardState {
  const board: BoardState = { units: {}, tiles: { ...tiles } };
  placements.forEach((p, i) => {
    const def = units[p.def];
    if (!def) throw new ContentError(`unknown unit definition '${p.def}'`);
    board.units[p.id] = {
      id: p.id,
      def: p.def,
      side: p.side,
      pos: p.pos,
      facing: p.facing,
      hp: p.hp ?? def.hp,
      maxHp: def.hp,
      block: 0,
      statuses: { ...def.statuses },
      createdAt: -placements.length + i,
    };
  });
  return board;
}

export function unitAt(board: BoardState, pos: Pos): UnitState | undefined {
  return Object.values(board.units).find((u) => u.pos === pos);
}

const str = (v: unknown) => v as string;
const num = (v: unknown) => v as number;
const turnKey = (state: GameState<unknown>) => `${state.turn.round}:${state.turn.activeSide}`;

export function boardModule<W extends BoardWorld>(config: BoardConfig): RulesModule<W> {
  const topo = config.topology;
  const tiles = config.tiles ?? {};
  const unitDefs = config.units ?? {};
  const collision = config.collision ?? 'bump';
  const bumpDamage = config.bumpDamage ?? 1;
  const edge = config.edge ?? 'wall';

  const boardOf = (state: GameState<W>) => state.world.board;
  const blockedTile = (state: GameState<W>, pos: Pos) => tiles[boardOf(state).tiles[pos] ?? '']?.blocking === true;
  const free = (state: GameState<W>, pos: Pos) => !blockedTile(state, pos) && !unitAt(boardOf(state), pos);
  const unitOf = (ctx: { state: GameState<W> }, id: unknown) => boardOf(ctx.state).units[str(id)];
  const posOf = (ctx: { state: GameState<W> }, ref: unknown): Pos | undefined =>
    typeof ref === 'string' && topo.contains(ref) ? ref : unitOf(ctx, ref)?.pos;

  /** The neighbouring direction that best moves `pos` away from (or toward) `from`. */
  const directionRelativeTo = (pos: Pos, from: Pos, away: boolean): Dir | null => {
    const exact = away ? topo.directionTo(from, pos) : topo.directionTo(pos, from);
    if (exact) return exact;
    let best: Dir | null = null;
    let bestScore = away ? -Infinity : Infinity;
    for (const dir of topo.directions()) {
      const next = topo.step(pos, dir);
      if (next === null) continue;
      const d = topo.distance(from, next);
      if (away ? d > bestScore : d < bestScore) {
        best = dir;
        bestScore = d;
      }
    }
    return best;
  };

  const moveStep = (unit: string, to: Pos, movement: string): Step => ({ kind: 'moveUnit', unit, to, movement });

  /** Voluntary movement: stops before anything in the way, no collision damage. */
  const walk = (ctx: EffectContext<W>, unit: string, dir: Dir, distance: number) => {
    for (let i = 0; i < distance; i++) {
      const u = unitOf(ctx, unit);
      if (!u) return;
      const next = topo.step(u.pos, dir);
      if (next === null || !free(ctx.state, next)) return;
      if (ctx.step(moveStep(unit, next, 'step')).halted) return;
    }
  };

  /** Forced movement with the game's collision rule (§11). */
  const force = (ctx: EffectContext<W>, unit: string, dir: Dir, distance: number, movement: 'push' | 'pull') => {
    for (let i = 0; i < distance; i++) {
      const mover = unitOf(ctx, unit);
      if (!mover) return;
      const next = topo.step(mover.pos, dir);

      if (next === null && edge === 'fall') {
        ctx.step({ kind: 'fall', unit });
        return;
      }
      if (next !== null && free(ctx.state, next)) {
        if (ctx.step(moveStep(unit, next, movement)).halted) return;
        continue;
      }
      if (collision === 'stop') return;

      const blocker = next === null ? undefined : unitAt(boardOf(ctx.state), next);
      if (collision === 'chain' && blocker) {
        // Find the front of the line of units; it shifts only if the tile beyond is free.
        const line = [blocker];
        let front = topo.step(blocker.pos, dir);
        while (front !== null) {
          const next = unitAt(boardOf(ctx.state), front);
          if (!next) break;
          line.push(next);
          front = topo.step(next.pos, dir);
        }
        if (front !== null && free(ctx.state, front)) {
          for (const u of line.reverse()) ctx.step(moveStep(u.id, topo.step(u.pos, dir) as Pos, movement));
          if (ctx.step(moveStep(unit, next as Pos, movement)).halted) return;
          continue;
        }
      }
      const hits: Step[] = [{ kind: 'damage', unit, amount: bumpDamage, source: 'collision' }];
      if (blocker) hits.push({ kind: 'damage', unit: blocker.id, amount: bumpDamage, source: 'collision' });
      ctx.step({ kind: 'collide', unit, into: blocker?.id ?? null, pos: next });
      ctx.step(hits);
      return;
    }
  };

  const sourcePos = (ctx: EffectContext<W>, p: Record<string, unknown>): Pos => {
    const ref = p.from ?? p.toward ?? ctx.item.source;
    const pos = posOf(ctx, ref);
    if (!pos) throw new ContentError(`cannot find the position to push from or pull toward ('${String(ref)}')`);
    return pos;
  };

  const targets = (p: Record<string, unknown>): string[] =>
    Array.isArray(p.target) ? (p.target as string[]) : [str(p.target ?? p.unit)];

  const moveAction: ActionDef<W> | undefined = config.moveAction && {
    list(state, side) {
      const out = [];
      const { range, oncePerTurn = true, cost } = config.moveAction as MoveActionConfig;
      const resources = (state.world as Partial<{ cards: { resources: Record<SideId, Record<string, number>> } }>).cards
        ?.resources[side];
      if (cost && !Object.entries(cost).every(([r, n]) => (resources?.[r] ?? 0) >= n)) return [];
      const board = boardOf(state);
      for (const u of Object.values(board.units).sort((a, b) => topo.compare(a.pos, b.pos))) {
        if (u.side !== side || (oncePerTurn && u.movedOn === turnKey(state))) continue;
        for (const to of topo.positions()) {
          if (to === u.pos || topo.distance(u.pos, to) > range || !free(state, to)) continue;
          const path = findPath(topo, u.pos, to, (p) => free(state, p));
          if (path && path.length - 1 <= range) out.push({ type: 'move', side, unit: u.id, to });
        }
      }
      return out;
    },
    perform(ctx, action) {
      const { cost } = config.moveAction as MoveActionConfig;
      const costs = Object.entries(cost ?? {}).filter(([, n]) => n > 0);
      if (costs.length > 0) {
        ctx.step(costs.map(([resource, n]) => ({ kind: 'resource', side: action.side, resource, delta: -n, reason: 'cost' })));
      }
      ctx.step({ kind: 'markMoved', unit: action.unit, turn: turnKey(ctx.state) });
      ctx.announce({
        kind: 'move',
        controller: action.side,
        source: str(action.unit),
        effects: [{ op: 'moveTo', unit: action.unit, to: action.to }],
        vars: {},
      });
    },
  };

  return {
    name: 'board',
    ...(moveAction && { actions: { move: moveAction } }),

    steps: {
      moveUnit(state, s) {
        const u = boardOf(state).units[str(s.unit)];
        if (!u) return [];
        const from = u.pos;
        u.pos = str(s.to);
        if (s.movement === 'step') u.facing = topo.directionTo(from, u.pos) ?? u.facing;
        const base = { unit: u.id, side: u.side, movement: s.movement };
        return [
          { type: 'UnitLeftTile', ...base, pos: from },
          { type: 'UnitEnteredTile', ...base, pos: u.pos, from },
        ];
      },
      swapUnits(state, s) {
        const a = boardOf(state).units[str(s.a)];
        const b = boardOf(state).units[str(s.b)];
        if (!a || !b) return [];
        [a.pos, b.pos] = [b.pos, a.pos];
        return [
          { type: 'UnitsSwapped', a: a.id, b: b.id },
          { type: 'UnitEnteredTile', unit: a.id, side: a.side, movement: 'swap', pos: a.pos, from: b.pos },
          { type: 'UnitEnteredTile', unit: b.id, side: b.side, movement: 'swap', pos: b.pos, from: a.pos },
        ];
      },
      face(state, s) {
        const u = boardOf(state).units[str(s.unit)];
        if (!u || u.facing === s.dir) return [];
        u.facing = str(s.dir);
        return [{ type: 'UnitTurned', unit: u.id, facing: u.facing }];
      },
      collide(_state, s) {
        return [{ type: 'UnitCollided', unit: s.unit, into: s.into, pos: s.pos }];
      },
      fall(state, s) {
        const u = boardOf(state).units[str(s.unit)];
        if (!u) return [];
        u.hp = 0;
        return [{ type: 'UnitFell', unit: u.id, side: u.side, pos: u.pos }];
      },
      damage(state, s): EventInput[] {
        const u = boardOf(state).units[str(s.unit)];
        if (!u) return [];
        const amount = num(s.amount);
        if (amount <= 0) return [{ type: 'AttackBlocked', unit: u.id, side: u.side, source: s.source ?? null }];
        u.hp -= amount;
        return [{ type: 'DamageDealt', unit: u.id, side: u.side, amount, source: s.source ?? null }];
      },
      gainBlock(state, s) {
        const u = boardOf(state).units[str(s.unit)];
        if (!u) return [];
        u.block += num(s.amount);
        return [{ type: 'BlockGained', unit: u.id, amount: s.amount, value: u.block }];
      },
      loseBlock(state, s) {
        const u = boardOf(state).units[str(s.unit)];
        if (!u) return [];
        const lost = Math.min(u.block, num(s.amount));
        u.block -= lost;
        return lost > 0 ? [{ type: 'BlockLost', unit: u.id, amount: lost, value: u.block }] : [];
      },
      heal(state, s) {
        const u = boardOf(state).units[str(s.unit)];
        if (!u) return [];
        const before = u.hp;
        u.hp = Math.min(u.maxHp, u.hp + num(s.amount));
        return u.hp > before ? [{ type: 'Healed', unit: u.id, amount: u.hp - before }] : [];
      },
      spawn(state, s) {
        const def = unitDefs[str(s.def)];
        if (!def) throw new ContentError(`unknown unit definition '${str(s.def)}'`);
        const unit: UnitState = {
          id: str(s.id),
          def: str(s.def),
          side: str(s.side),
          pos: str(s.pos),
          facing: str(s.facing),
          hp: def.hp,
          maxHp: def.hp,
          block: 0,
          statuses: { ...def.statuses },
          createdAt: num(s.createdAt),
        };
        boardOf(state).units[unit.id] = unit;
        return [{ type: 'UnitSpawned', unit: unit.id, def: unit.def, side: unit.side, pos: unit.pos }];
      },
      markMoved(state, s) {
        const u = boardOf(state).units[str(s.unit)];
        if (u) u.movedOn = str(s.turn);
        return [];
      },
      // Deaths (§4 step 4): the unit is still in play for UnitDied so its own
      // triggers match; `remove` then takes it off the board.
      die(state, s) {
        const u = boardOf(state).units[str(s.unit)];
        return u ? [{ type: 'UnitDied', unit: u.id, def: u.def, side: u.side, pos: u.pos }] : [];
      },
      remove(state, s) {
        const board = boardOf(state);
        const u = board.units[str(s.unit)];
        if (!u) return [];
        delete board.units[u.id];
        return [{ type: 'UnitLeftPlay', unit: u.id, def: u.def, side: u.side, pos: u.pos, reason: s.reason ?? null }];
      },
    },

    ops: {
      damage(ctx, p) {
        const steps = targets(p)
          .filter((id) => unitOf(ctx, id))
          .sort((a, b) => topo.compare(unitOf(ctx, a)?.pos as Pos, unitOf(ctx, b)?.pos as Pos))
          .map((unit) => ({ kind: 'damage', unit, amount: num(p.amount), source: p.source ?? 'effect' }));
        if (steps.length > 0) ctx.step(steps);
      },
      gainBlock(ctx, p) {
        if (unitOf(ctx, p.unit)) ctx.step({ kind: 'gainBlock', unit: p.unit, amount: p.amount });
      },
      heal(ctx, p) {
        if (unitOf(ctx, p.unit)) ctx.step({ kind: 'heal', unit: p.unit, amount: p.amount });
      },
      step(ctx, p) {
        walk(ctx, str(p.unit), str(p.dir), num(p.distance ?? 1));
      },
      /** Walks along a shortest open path, stopping early if something blocks or halts it. */
      moveTo(ctx, p) {
        const u = unitOf(ctx, p.unit);
        if (!u) return;
        const path = findPath(topo, u.pos, str(p.to), (pos) => free(ctx.state, pos));
        if (!path) return;
        for (const pos of path.slice(1, (p.maxDistance as number | undefined) === undefined ? undefined : num(p.maxDistance) + 1)) {
          if (!unitOf(ctx, p.unit) || !free(ctx.state, pos)) return;
          if (ctx.step(moveStep(str(p.unit), pos, 'step')).halted) return;
        }
      },
      push(ctx, p) {
        const u = unitOf(ctx, p.unit);
        if (!u) return;
        const dir = (p.dir as Dir | undefined) ?? directionRelativeTo(u.pos, sourcePos(ctx, p), true);
        if (dir) force(ctx, u.id, dir, num(p.distance ?? 1), 'push');
      },
      pull(ctx, p) {
        const u = unitOf(ctx, p.unit);
        if (!u) return;
        const toward = sourcePos(ctx, p);
        const dir = directionRelativeTo(u.pos, toward, false);
        const distance = Math.min(num(p.distance ?? 1), Math.max(0, topo.distance(u.pos, toward) - 1));
        if (dir) force(ctx, u.id, dir, distance, 'pull');
      },
      teleport(ctx, p) {
        if (unitOf(ctx, p.unit) && free(ctx.state, str(p.to))) ctx.step(moveStep(str(p.unit), str(p.to), 'teleport'));
      },
      swap(ctx, p) {
        if (unitOf(ctx, p.a) && unitOf(ctx, p.b)) ctx.step({ kind: 'swapUnits', a: p.a, b: p.b });
      },
      face(ctx, p) {
        if (unitOf(ctx, p.unit)) ctx.step({ kind: 'face', unit: p.unit, dir: p.dir });
      },
      spawn(ctx, p) {
        const pos = str(p.pos);
        if (!free(ctx.state, pos)) return;
        const id = ctx.newId('unit');
        ctx.setVar('spawned', { unit: id });
        ctx.step({
          kind: 'spawn',
          id,
          def: p.def,
          side: p.side ?? ctx.item.controller,
          pos,
          facing: p.facing ?? topo.directions()[0],
          createdAt: ctx.state.seq,
        });
      },
    },

    listeners(state) {
      const out: Listener<W>[] = [];
      const board = boardOf(state);
      for (const [pos, tileId] of Object.entries(board.tiles)) {
        const effects = tiles[tileId]?.onEnter;
        if (!effects) continue;
        out.push({
          kind: 'interrupt',
          id: `tile:${tileId}@${pos}`,
          source: null,
          controller: null,
          layer: 'rules',
          timestamp: 0,
          matches: (e) => e.type === 'UnitEnteredTile' && e.pos === pos,
          effects,
        });
      }
      for (const u of Object.values(board.units)) {
        if (u.block <= 0) continue;
        out.push({
          kind: 'modifier',
          id: `block:${u.id}`,
          source: u.id,
          controller: u.side,
          layer: 'innate',
          timestamp: u.createdAt,
          matches: (s) => s.kind === 'damage' && s.unit === u.id && num(s.amount) > 0 && s.source !== 'hpLoss',
          modify(s, st) {
            const absorbed = Math.min(boardOf(st).units[u.id]?.block ?? 0, num(s.amount));
            return [
              { kind: 'loseBlock', unit: u.id, amount: absorbed },
              { ...s, amount: num(s.amount) - absorbed },
            ];
          },
        });
      }
      return out;
    },

    stateChecks: [
      (ctx) => {
        let changed = false;
        for (const u of Object.values(boardOf(ctx.state).units)) {
          if (u.hp > u.maxHp) {
            u.hp = u.maxHp;
            changed = true;
          }
        }
        return changed;
      },
      (ctx) => {
        const dying = Object.values(boardOf(ctx.state).units)
          .filter((u) => u.hp <= 0)
          .sort((a, b) => topo.compare(a.pos, b.pos));
        if (dying.length === 0) return false;
        ctx.step(dying.map((u) => ({ kind: 'die', unit: u.id })));
        ctx.step(dying.map((u) => ({ kind: 'remove', unit: u.id, reason: 'died' })));
        return true;
      },
    ],
  };
}
