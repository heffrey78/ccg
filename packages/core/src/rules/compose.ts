/**
 * Builds a game's rules from engine modules (zones, board, statuses...) plus
 * the game's own phases and outcome. Each module owns a slice of the world and
 * contributes ops, steps, actions, listeners and state checks.
 *
 * Ops can carry content metadata (decision #12): `defineOp(meta, run)` keeps an
 * op's runtime handler next to the description the validator, card-text
 * renderer and editor read. `describeOps()` collects that metadata.
 */
import { OpRegistry, type OpMeta } from '@ccg/content';
import { ContentError } from '../kernel/params.js';
import type { GameRules, OpHandler, PhaseContext, StackItem } from '../kernel/types.js';

/** An op with its content metadata. Ops without metadata are internal: content cannot use them. */
export interface OpDefinition<W> {
  meta: Omit<OpMeta, 'id'>;
  run: OpHandler<W>;
}

export type ModuleOp<W> = OpHandler<W> | OpDefinition<W>;

export function defineOp<W>(meta: Omit<OpMeta, 'id'>, run: OpHandler<W>): OpDefinition<W> {
  return { meta, run };
}

export interface RulesModule<W> {
  /** Used in error messages when two modules clash. */
  name: string;
  ops?: Record<string, ModuleOp<W>>;
  steps?: GameRules<W>['steps'];
  actions?: NonNullable<GameRules<W>['actions']>;
  listeners?: GameRules<W>['listeners'];
  stateChecks?: GameRules<W>['stateChecks'];
  onItemResolved?(ctx: PhaseContext<W>, item: StackItem): void;
  view?: GameRules<W>['view'];
  redact?: GameRules<W>['redact'];
  presentation?: GameRules<W>['presentation'];
}

export type BaseRules<W> = Omit<GameRules<W>, 'ops' | 'steps'> & {
  ops?: Record<string, ModuleOp<W>>;
  steps?: GameRules<W>['steps'];
};

const runOf = <W>(op: ModuleOp<W>): OpHandler<W> => (typeof op === 'function' ? op : op.run);

function asModule<W>(base: BaseRules<W>): RulesModule<W> {
  return {
    name: 'game',
    ...(base.ops && { ops: base.ops }),
    ...(base.steps && { steps: base.steps }),
    ...(base.actions && { actions: base.actions }),
    ...(base.listeners && { listeners: base.listeners }),
    ...(base.stateChecks && { stateChecks: base.stateChecks }),
    ...(base.onItemResolved && { onItemResolved: base.onItemResolved }),
    ...(base.view && { view: base.view }),
    ...(base.redact && { redact: base.redact }),
    ...(base.presentation && { presentation: base.presentation }),
  };
}

/**
 * Merges modules into one rule set. The base's own ops, steps and actions are
 * merged like a module's; names must be unique across everything. State checks
 * run in module order, then the base's.
 */
export function composeRules<W>(base: BaseRules<W>, modules: RulesModule<W>[]): GameRules<W> {
  const all: RulesModule<W>[] = [...modules, asModule(base)];

  const merge = <T>(field: 'ops' | 'steps' | 'actions' | 'presentation'): Record<string, T> => {
    const out: Record<string, T> = {};
    const owner: Record<string, string> = {};
    for (const m of all) {
      for (const [key, value] of Object.entries((m[field] ?? {}) as Record<string, T>)) {
        if (key in out) throw new ContentError(`${field === 'presentation' ? 'presentation' : field.slice(0, -1)} '${key}' is defined by both ${owner[key]} and ${m.name}`);
        out[key] = value;
        owner[key] = m.name;
      }
    }
    return out;
  };

  const listenerSources = all.flatMap((m) => (m.listeners ? [m.listeners] : []));
  const resolvedHooks = all.flatMap((m) => (m.onItemResolved ? [m.onItemResolved] : []));
  const ops = merge<ModuleOp<W>>('ops');

  const rules: GameRules<W> = {
    round: base.round,
    ops: Object.fromEntries(Object.entries(ops).map(([id, op]) => [id, runOf(op)])),
    steps: merge('steps'),
    actions: merge('actions'),
    listeners: (state) => listenerSources.flatMap((source) => source(state)),
    stateChecks: all.flatMap((m) => m.stateChecks ?? []),
    onItemResolved: (ctx, item) => {
      for (const hook of resolvedHooks) hook(ctx, item);
    },
  };
  if (base.outcome) rules.outcome = base.outcome;
  if (base.limits) rules.limits = base.limits;
  if (base.windows) rules.windows = base.windows;
  if (base.undo) rules.undo = base.undo;
  const presentation = merge<unknown>('presentation');
  if (Object.keys(presentation).length > 0) rules.presentation = presentation;
  const views = all.flatMap((m) => (m.view ? [m.view] : []));
  if (views.length > 0) {
    rules.view = (world, viewer, state) => {
      for (const view of views) view(world, viewer, state);
    };
  }
  const redactors = all.flatMap((m) => (m.redact ? [m.redact] : []));
  if (redactors.length > 0) {
    rules.redact = (event, viewer, state) => {
      let current: typeof event | null = event;
      for (const redact of redactors) {
        if (current === null) return null;
        current = redact(current, viewer, state);
      }
      return current;
    };
  }
  return rules;
}

/** Metadata for every content-visible op in these modules, for validation and the editor. */
export function describeOps<W>(modules: RulesModule<W>[], registry = new OpRegistry()): OpRegistry {
  for (const m of modules) {
    for (const [id, op] of Object.entries(m.ops ?? {})) {
      if (typeof op !== 'function') registry.register({ id, ...op.meta });
    }
  }
  return registry;
}
