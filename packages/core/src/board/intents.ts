/**
 * Telegraphed enemy intents and data-driven behaviours (#27, requirement #4),
 * following resolution-order §10.
 *
 * Each round a side's units declare intents (in a declaration phase), which
 * are stored in state for the UI. In the side's action phase each intent goes
 * on the stack, in declaration order, and resolves against the board as it is
 * then: unit-bound intents follow their target (and whiff or retarget if it is
 * out of reach), tile-bound intents hit whatever stands on their tiles.
 *
 * World slice: `intents`. Behaviours are static, per unit definition.
 */
import type { Rng } from '../rng.js';
import { z } from 'zod';
import type { Effect, GameState, PhaseContext, PhaseDef, SideId, Step } from '../kernel/types.js';
import { defineOp, type RulesModule } from '../rules/compose.js';
import { findPath, type Dir, type PatternShape, type Pos, type Topology } from './topology.js';
import { NEUTRAL_SIDE, scaleDamage, unitAt, type BoardWorld, type TileDef, type UnitState } from './units.js';

export type Selector = 'nearestEnemy' | 'weakestEnemy' | 'strongestEnemy';

export type IntentTarget =
  | { kind: 'none' }
  | { kind: 'self' }
  /** `bound: 'unit'` (default) follows the unit; `'tile'` hits where it stood when declared. */
  | { kind: 'unit'; select: Selector; range?: number; bound?: 'unit' | 'tile' }
  | { kind: 'pattern'; shape: PatternShape; aim: 'nearestEnemy' | 'facing' }
  /** Empty tiles next to the unit (#115), e.g. to summon onto: the one it faces first, then toward the nearest enemy. */
  | { kind: 'freeAdjacent'; count?: number };

export interface IntentDef {
  name: string;
  icon?: string;
  target: IntentTarget;
  /** Run at resolution with `self`, `target`, `dir`, `cells` and `targets` bound. */
  effects: Effect[];
  /** How much the opposing side sees (#56). Default full. */
  visibility?: 'full' | 'partial' | 'hidden';
  /** A unit-bound intent whose target is gone or out of range. Default skip. */
  onInvalidTarget?: 'skip' | 'retarget';
}

export type BehaviorCondition =
  | { kind: 'always' }
  | { kind: 'enemyWithin'; range: number }
  | { kind: 'hpAtMost'; fraction: number }
  | { kind: 'not'; cond: BehaviorCondition }
  | { kind: 'all' | 'any'; of: BehaviorCondition[] };

export type Behavior =
  | { kind: 'intent'; intent: IntentDef }
  /** Cycles through its steps, one per round. */
  | { kind: 'sequence'; steps: Behavior[] }
  /** Picks an option with the seeded random generator. */
  | { kind: 'weighted'; options: { weight: number; then: Behavior }[] }
  | { kind: 'if'; cond: BehaviorCondition; then: Behavior; else: Behavior };

export interface DeclaredIntent {
  id: string;
  unit: string;
  side: SideId;
  name: string;
  icon?: string;
  effects: Effect[];
  bound: 'unit' | 'tile' | 'none';
  target?: string;
  range?: number;
  dir?: Dir;
  cells?: Pos[];
  selector?: Selector;
  visibility: 'full' | 'partial' | 'hidden';
  onInvalidTarget: 'skip' | 'retarget';
  /** Skip resolution this round and keep the intent for the next. */
  delayed?: boolean;
}

export interface IntentsState {
  /** Declared intents, in declaration order. */
  declared: DeclaredIntent[];
  /** Per unit: position in nested sequences, keyed by tree path. */
  cursors: Record<string, Record<string, number>>;
}

export interface IntentsWorld {
  intents: IntentsState;
}

export function createIntentsState(): IntentsState {
  return { declared: [], cursors: {} };
}

export interface IntentsConfig {
  topology: Topology;
  /** Behaviour by unit definition id. */
  behaviors: Record<string, Behavior>;
  /** Tile definitions, so `freeAdjacent` skips blocking tiles. */
  tiles?: Record<string, TileDef>;
}

const str = (v: unknown) => v as string;

export function intentsModule<W extends BoardWorld & IntentsWorld>(config: IntentsConfig): RulesModule<W> & {
  /** Phase that declares the side's intents (put it before the opponents' turns). */
  declarePhase(side: SideId, id?: string): PhaseDef<W>;
  /** Phase in which the side's declared intents resolve. */
  resolvePhase(side: SideId, id?: string): PhaseDef<W>;
} {
  const topo = config.topology;

  const enemiesOf = (state: GameState<W>, unit: UnitState) =>
    Object.values(state.world.board.units)
      .filter((u) => u.side !== unit.side && u.side !== NEUTRAL_SIDE)
      .sort((a, b) => topo.compare(a.pos, b.pos));

  const select = (state: GameState<W>, unit: UnitState, selector: Selector): UnitState | undefined => {
    const foes = enemiesOf(state, unit);
    const dist = (u: UnitState) => topo.distance(unit.pos, u.pos);
    const by = {
      nearestEnemy: (a: UnitState, b: UnitState) => dist(a) - dist(b),
      weakestEnemy: (a: UnitState, b: UnitState) => a.hp - b.hp || dist(a) - dist(b),
      strongestEnemy: (a: UnitState, b: UnitState) => b.hp - a.hp || dist(a) - dist(b),
    }[selector];
    return foes.slice().sort(by)[0];
  };

  /** Direction from `from` that best heads toward `to`. */
  const toward = (from: Pos, to: Pos, fallback: Dir): Dir => {
    const exact = topo.directionTo(from, to);
    if (exact) return exact;
    let best = fallback;
    let bestDistance = Infinity;
    for (const dir of topo.directions()) {
      const next = topo.step(from, dir);
      if (next !== null && topo.distance(next, to) < bestDistance) {
        best = dir;
        bestDistance = topo.distance(next, to);
      }
    }
    return best;
  };

  const holds = (state: GameState<W>, unit: UnitState, cond: BehaviorCondition): boolean => {
    switch (cond.kind) {
      case 'always':
        return true;
      case 'enemyWithin':
        return enemiesOf(state, unit).some((u) => topo.distance(unit.pos, u.pos) <= cond.range);
      case 'hpAtMost':
        return unit.hp <= unit.maxHp * cond.fraction;
      case 'not':
        return !holds(state, unit, cond.cond);
      case 'all':
        return cond.of.every((c) => holds(state, unit, c));
      case 'any':
        return cond.of.some((c) => holds(state, unit, c));
    }
  };

  /** Walks a behaviour tree to an intent, advancing sequence cursors as it goes. */
  const choose = (state: GameState<W>, unit: UnitState, rng: Rng, node: Behavior, path: string, cursors: Record<string, number>): IntentDef => {
    switch (node.kind) {
      case 'intent':
        return node.intent;
      case 'sequence': {
        const index = (cursors[path] ?? 0) % node.steps.length;
        cursors[path] = index + 1;
        return choose(state, unit, rng, node.steps[index] as Behavior, `${path}.${index}`, cursors);
      }
      case 'weighted': {
        const picked = rng.weightedPick(node.options, (o) => o.weight);
        return choose(state, unit, rng, picked.then, `${path}.${node.options.indexOf(picked)}`, cursors);
      }
      case 'if':
        return holds(state, unit, node.cond)
          ? choose(state, unit, rng, node.then, `${path}.then`, cursors)
          : choose(state, unit, rng, node.else, `${path}.else`, cursors);
    }
  };

  /** A declared intent with its target fixed now (§10). Also returns a facing change, if aiming turns the unit. */
  const declare = (state: GameState<W>, unit: UnitState, def: IntentDef, id: string): { intent: DeclaredIntent; face?: Dir } => {
    const intent: DeclaredIntent = {
      id,
      unit: unit.id,
      side: unit.side,
      name: def.name,
      ...(def.icon && { icon: def.icon }),
      // Difficulty scales the damage when it is declared, so the telegraph shows what will land.
      effects: scaleDamage(def.effects, state.world.board.scale?.[unit.side]?.damage),
      bound: 'none',
      visibility: def.visibility ?? 'full',
      onInvalidTarget: def.onInvalidTarget ?? 'skip',
    };
    const t = def.target;
    if (t.kind === 'self') {
      intent.bound = 'unit';
      intent.target = unit.id;
    } else if (t.kind === 'unit') {
      const target = select(state, unit, t.select);
      intent.selector = t.select;
      if (t.range !== undefined) intent.range = t.range;
      if (target) {
        intent.bound = t.bound ?? 'unit';
        intent.target = t.bound === 'tile' ? target.pos : target.id;
        if (t.bound === 'tile') intent.cells = [target.pos];
      }
    } else if (t.kind === 'freeAdjacent') {
      const enemy = select(state, unit, 'nearestEnemy');
      const first = [unit.facing, ...(enemy ? [toward(unit.pos, enemy.pos, unit.facing)] : [])].map((d) => topo.step(unit.pos, d));
      const free = (pos: Pos) => !unitAt(state.world.board, pos) && config.tiles?.[state.world.board.tiles[pos] ?? '']?.blocking !== true;
      const cells = [...new Set([...first.filter((p): p is Pos => p !== null), ...topo.neighbors(unit.pos)])].filter(free).slice(0, t.count ?? 1);
      if (cells.length > 0) {
        intent.bound = 'tile';
        intent.target = cells[0] as Pos;
        intent.cells = cells;
      }
    } else if (t.kind === 'pattern') {
      const aimAt = t.aim === 'nearestEnemy' ? select(state, unit, 'nearestEnemy') : undefined;
      const dir = aimAt ? toward(unit.pos, aimAt.pos, unit.facing) : unit.facing;
      intent.bound = 'tile';
      intent.dir = dir;
      intent.cells = topo.pattern(unit.pos, dir, t.shape);
      return { intent, ...(dir !== unit.facing && { face: dir }) };
    }
    return { intent };
  };

  const declareFor = (ctx: PhaseContext<W>, side: SideId) => {
    const world = ctx.state.world;
    const units = Object.values(world.board.units)
      .filter((u) => u.side === side)
      .sort((a, b) => topo.compare(a.pos, b.pos));
    const steps: Step[] = [];
    for (const unit of units) {
      const existing = world.intents.declared.find((i) => i.unit === unit.id);
      if (existing?.delayed) continue;
      if (existing) steps.push({ kind: 'clearIntent', intent: existing.id, outcome: 'replaced' });
      const behavior = config.behaviors[unit.def];
      if (!behavior) continue;
      const cursors = { ...world.intents.cursors[unit.id] };
      const chosen = choose(ctx.state, unit, ctx.rng, behavior, 'root', cursors);
      const { intent, face } = declare(ctx.state, unit, chosen, ctx.newId('intent'));
      if (face) steps.push({ kind: 'face', unit: unit.id, dir: face });
      steps.push({ kind: 'declareIntent', intent, cursors });
    }
    for (const step of steps) ctx.step(step);
  };

  const resolveFor = (ctx: PhaseContext<W>, side: SideId) => {
    const pending = ctx.state.world.intents.declared.filter((i) => i.side === side);
    // Push in reverse so the first declared resolves first.
    for (const intent of [...pending].reverse()) {
      if (intent.delayed) {
        ctx.step({ kind: 'undelayIntent', intent: intent.id });
        continue;
      }
      // `target` is exposed for reaction conditions ("an attack targeting you") and can be redirected (#57).
      ctx.announce({
        kind: 'intent',
        controller: side,
        source: intent.unit,
        effects: [{ op: 'resolveIntent', intent: intent.id }],
        vars: { intent: intent.id, ...(intent.target !== undefined && { target: intent.target }) },
      });
    }
  };

  const findIntent = (state: GameState<W>, id: unknown) => state.world.intents.declared.find((i) => i.id === id);

  /** What a viewer on another side may know of an intent (#53): full, its name only, or that it exists. */
  const shown = (intent: DeclaredIntent, viewer: SideId | null): DeclaredIntent | Partial<DeclaredIntent> => {
    if (viewer === intent.side || intent.visibility === 'full') return intent;
    const base = { id: intent.id, unit: intent.unit, side: intent.side, visibility: intent.visibility };
    return intent.visibility === 'partial' ? { ...base, name: intent.name, ...(intent.icon && { icon: intent.icon }) } : base;
  };

  return {
    name: 'intents',
    view(world, viewer) {
      // Runs after the board's view: intents of units the viewer cannot see go too.
      world.intents.declared = world.intents.declared
        .filter((i) => i.side === viewer || world.board.units[i.unit])
        .map((i) => shown(i, viewer)) as DeclaredIntent[];
      if (viewer === null) world.intents.cursors = {};
      else for (const unit of Object.keys(world.intents.cursors)) if (world.board.units[unit]?.side !== viewer) delete world.intents.cursors[unit];
    },
    redact(event, viewer) {
      if (event.type !== 'IntentDeclared') return event;
      const visibility = event.visibility as DeclaredIntent['visibility'];
      if (viewer === event.side || visibility === 'full') return event;
      const { target: _t, cells: _c, bound: _b, ...rest } = event;
      if (visibility === 'partial') return rest;
      const { name: _n, ...unnamed } = rest;
      return unnamed;
    },
    declarePhase: (side, id = `${side}:intents`) => ({ id, side, enter: (ctx) => declareFor(ctx, side) }),
    resolvePhase: (side, id = `${side}:act`) => ({ id, side, enter: (ctx) => resolveFor(ctx, side) }),

    steps: {
      revealIntent(state, s) {
        const intent = state.world.intents.declared.find((i) => i.id === s.intent);
        if (!intent) return [];
        intent.visibility = 'full';
        return [{ type: 'IntentRevealed', intent: intent.id, unit: intent.unit, side: intent.side, name: intent.name, target: intent.target ?? null, cells: intent.cells ?? null }];
      },
      convertUnit(state, s) {
        const u = state.world.board.units[str(s.unit)];
        if (!u) return [];
        const from = u.side;
        u.side = str(s.side);
        return [{ type: 'UnitConverted', unit: u.id, from, side: u.side }];
      },
      declareIntent(state, s) {
        const intent = s.intent as DeclaredIntent;
        state.world.intents.declared.push(intent);
        state.world.intents.cursors[intent.unit] = s.cursors as Record<string, number>;
        return [
          {
            type: 'IntentDeclared',
            intent: intent.id,
            unit: intent.unit,
            side: intent.side,
            name: intent.name,
            bound: intent.bound,
            target: intent.target ?? null,
            cells: intent.cells ?? null,
            visibility: intent.visibility,
          },
        ];
      },
      clearIntent(state, s) {
        const list = state.world.intents.declared;
        const index = list.findIndex((i) => i.id === s.intent);
        if (index < 0) return [];
        const [intent] = list.splice(index, 1) as [DeclaredIntent];
        const type = { resolved: 'IntentResolved', whiffed: 'IntentWhiffed', cancelled: 'IntentCancelled', replaced: 'IntentReplaced' }[str(s.outcome)];
        return [{ type: type ?? 'IntentCleared', intent: intent.id, unit: intent.unit, side: intent.side }];
      },
      delayIntent(state, s) {
        const intent = findIntent(state, s.intent);
        if (!intent || intent.delayed) return [];
        intent.delayed = true;
        return [{ type: 'IntentDelayed', intent: intent.id, unit: intent.unit }];
      },
      undelayIntent(state, s) {
        const intent = findIntent(state, s.intent);
        if (intent) delete intent.delayed;
        return [];
      },
    },

    ops: {
      // Internal: resolves one declared intent against the current board.
      resolveIntent(ctx, p) {
        const intent = findIntent(ctx.state, p.intent);
        if (!intent) return;
        const board = ctx.state.world.board;
        const unit = board.units[intent.unit];
        if (!unit) {
          ctx.step({ kind: 'clearIntent', intent: intent.id, outcome: 'cancelled' });
          return;
        }
        // A response may have redirected the intent to a new target.
        let target = (ctx.item.vars.target as string | undefined) ?? intent.target;
        if (intent.bound === 'unit' && target !== undefined && target !== unit.id) {
          const t = board.units[target];
          const reachable = t && (intent.range === undefined || topo.distance(unit.pos, t.pos) <= intent.range);
          if (!reachable) {
            const replacement =
              intent.onInvalidTarget === 'retarget' && intent.selector ? select(ctx.state, unit, intent.selector) : undefined;
            const ok = replacement && (intent.range === undefined || topo.distance(unit.pos, replacement.pos) <= intent.range);
            if (!ok) {
              ctx.step({ kind: 'clearIntent', intent: intent.id, outcome: 'whiffed' });
              return;
            }
            target = replacement.id;
          }
        }
        ctx.setVar('self', unit.id);
        if (target !== undefined) ctx.setVar('target', target);
        if (intent.dir) ctx.setVar('dir', intent.dir);
        if (intent.cells) {
          ctx.setVar('cells', intent.cells);
          ctx.setVar(
            'targets',
            intent.cells.flatMap((pos) => {
              const u = unitAt(board, pos);
              return u ? [u.id] : [];
            }),
          );
        }
        ctx.run(intent.effects);
        ctx.step({ kind: 'clearIntent', intent: intent.id, outcome: 'resolved' });
      },
      cancelIntent: defineOp(
        {
          displayName: 'Cancel intent',
          description: "Cancel a unit's declared intent (the target's).",
          params: z.object({ unit: z.string().min(1).optional() }),
          text: "Cancel the target's intent.",
          widgets: { unit: 'unit' },
          category: 'intents',
        },
        (ctx, p) => {
          const unit = str(p.unit ?? ctx.item.vars.target);
          const intent = ctx.state.world.intents.declared.find((i) => i.unit === unit);
          if (intent) ctx.step({ kind: 'clearIntent', intent: intent.id, outcome: 'cancelled' });
        },
      ),
      revealIntent: defineOp(
        {
          displayName: 'Reveal intent',
          description: "Show a unit's declared intent (the target's) in full to everyone, target and effects included.",
          params: z.object({ unit: z.string().min(1).optional() }),
          text: "Reveal the target's intent.",
          widgets: { unit: 'unit' },
          category: 'intents',
        },
        (ctx, p) => {
          const unit = str(p.unit ?? ctx.item.vars.target);
          const intent = ctx.state.world.intents.declared.find((i) => i.unit === unit);
          if (intent && intent.visibility !== 'full') ctx.step({ kind: 'revealIntent', intent: intent.id });
        },
      ),
      convert: defineOp(
        {
          displayName: 'Convert',
          description: "Make a unit (the target) fight for a side (yours by default): its declared intent is cancelled, and from next round it acts for its new side.",
          params: z.object({ unit: z.string().min(1).optional(), side: z.string().min(1).optional() }),
          text: 'Turn the target to your side.',
          widgets: { unit: 'unit', side: 'side' },
          category: 'units',
        },
        (ctx, p) => {
          const unit = str(p.unit ?? ctx.item.vars.target);
          const side = (p.side as string | undefined) ?? ctx.item.controller;
          const u = ctx.state.world.board.units[unit];
          if (!u || !side || u.side === side) return;
          const intent = ctx.state.world.intents.declared.find((i) => i.unit === unit);
          if (intent) ctx.step({ kind: 'clearIntent', intent: intent.id, outcome: 'cancelled' });
          ctx.step({ kind: 'convertUnit', unit, side });
        },
      ),
      delayIntent: defineOp(
        {
          displayName: 'Delay intent',
          description: "Delay a unit's declared intent (the target's) by a round.",
          params: z.object({ unit: z.string().min(1).optional() }),
          text: "Delay the target's intent.",
          widgets: { unit: 'unit' },
          category: 'intents',
        },
        (ctx, p) => {
          const unit = str(p.unit ?? ctx.item.vars.target);
          const intent = ctx.state.world.intents.declared.find((i) => i.unit === unit);
          if (intent) ctx.step({ kind: 'delayIntent', intent: intent.id });
        },
      ),
      approach: defineOp(
        {
          displayName: 'Approach',
          description: 'Walk a unit (the acting unit) toward a target unit, stopping next to it.',
          params: z.object({ unit: z.string().min(1).optional(), target: z.string().min(1).optional(), distance: z.number().int().min(1) }),
          text: 'Approach {distance}.',
          widgets: { unit: 'unit', target: 'unit', distance: 'number' },
          category: 'movement',
        },
        (ctx, p) => {
          const board = ctx.state.world.board;
          const mover = board.units[str(p.unit ?? ctx.item.vars.self)];
          const goal = board.units[str(p.target ?? ctx.item.vars.target)];
          if (!mover || !goal) return;
          const open = (pos: Pos) => !unitAt(board, pos);
          let best: Pos[] | null = null;
          for (const pos of topo.neighbors(goal.pos)) {
            if (pos !== mover.pos && !open(pos)) continue;
            const path = pos === mover.pos ? [pos] : findPath(topo, mover.pos, pos, open);
            if (path && (best === null || path.length < best.length)) best = path;
          }
          for (const pos of (best ?? []).slice(1, (p.distance as number) + 1)) {
            const result = ctx.step({ kind: 'moveUnit', unit: mover.id, to: pos, movement: 'step' });
            if (result.halted || !ctx.state.world.board.units[mover.id]) return;
          }
        },
      ),
    },

    onItemResolved(ctx, item) {
      // A countered intent is spent, not kept for later.
      if (item.kind === 'intent' && item.countered && typeof item.vars.intent === 'string') {
        ctx.step({ kind: 'clearIntent', intent: item.vars.intent, outcome: 'cancelled' });
      }
    },

    stateChecks: [
      // An enemy that has left play loses its intent (§10).
      (ctx) => {
        const lost = ctx.state.world.intents.declared.filter((i) => !ctx.state.world.board.units[i.unit]);
        if (lost.length === 0) return false;
        ctx.step(lost.map((i) => ({ kind: 'clearIntent', intent: i.id, outcome: 'cancelled' })));
        return true;
      },
    ],
  };
}
