/**
 * Builds a game's rules from engine modules (zones, board, statuses...) plus
 * the game's own phases and outcome. Each module owns a slice of the world and
 * contributes ops, steps, actions, listeners and state checks.
 */
import { ContentError } from '../kernel/params.js';
import type { GameRules, PhaseContext, StackItem } from '../kernel/types.js';

export interface RulesModule<W> {
  /** Used in error messages when two modules clash. */
  name: string;
  ops?: GameRules<W>['ops'];
  steps?: GameRules<W>['steps'];
  actions?: NonNullable<GameRules<W>['actions']>;
  listeners?: GameRules<W>['listeners'];
  stateChecks?: GameRules<W>['stateChecks'];
  onItemResolved?(ctx: PhaseContext<W>, item: StackItem): void;
}

export type BaseRules<W> = Omit<GameRules<W>, 'ops' | 'steps'> & Partial<Pick<GameRules<W>, 'ops' | 'steps'>>;

/**
 * Merges modules into one rule set. The base's own ops, steps and actions are
 * merged like a module's; names must be unique across everything. State checks
 * run in module order, then the base's.
 */
export function composeRules<W>(base: BaseRules<W>, modules: RulesModule<W>[]): GameRules<W> {
  const all: RulesModule<W>[] = [
    ...modules,
    {
      name: 'game',
      ...(base.ops && { ops: base.ops }),
      ...(base.steps && { steps: base.steps }),
      ...(base.actions && { actions: base.actions }),
      ...(base.listeners && { listeners: base.listeners }),
      ...(base.stateChecks && { stateChecks: base.stateChecks }),
      ...(base.onItemResolved && { onItemResolved: base.onItemResolved }),
    },
  ];

  const merge = <T>(field: 'ops' | 'steps' | 'actions'): Record<string, T> => {
    const out: Record<string, T> = {};
    const owner: Record<string, string> = {};
    for (const m of all) {
      for (const [key, value] of Object.entries((m[field] ?? {}) as Record<string, T>)) {
        if (key in out) throw new ContentError(`${field.slice(0, -1)} '${key}' is defined by both ${owner[key]} and ${m.name}`);
        out[key] = value;
        owner[key] = m.name;
      }
    }
    return out;
  };

  const listenerSources = all.flatMap((m) => (m.listeners ? [m.listeners] : []));
  const resolvedHooks = all.flatMap((m) => (m.onItemResolved ? [m.onItemResolved] : []));

  const rules: GameRules<W> = {
    round: base.round,
    ops: merge('ops'),
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
  return rules;
}
