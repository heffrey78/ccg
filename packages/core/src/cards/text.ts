/**
 * Card text generated from effect data and op metadata (decision #12), so the
 * editor preview and the card face always match what the card does.
 */
import { renderText, type OpRegistry, type PatternShapeData, type Targeting } from '@ccg/content';
import { isVarRef } from '../kernel/params.js';
import type { Effect } from '../kernel/types.js';
import type { Condition } from '../rules/logic.js';

export interface TextOptions {
  /** Topology kind, for direction and area wording. */
  topology?: string;
  /** Display name for a content reference (a status, card or unit definition). */
  name?(ref: string): string | undefined;
}

/** Widgets whose values are references to content definitions. */
const REF_WIDGETS = new Set(['status', 'cardDef', 'unitDef']);

const COMPASS: Record<string, string> = {
  n: 'north',
  ne: 'north-east',
  e: 'east',
  se: 'south-east',
  s: 'south',
  sw: 'south-west',
  w: 'west',
  nw: 'north-west',
};
const LANE: Record<string, string> = { e: 'forward', w: 'back' };

const COMPARE: Record<string, string> = {
  '<': 'is less than',
  '<=': 'is at most',
  '==': 'is',
  '!=': 'is not',
  '>=': 'is at least',
  '>': 'is more than',
};

/** Text for a card: its explicit `text` if any, else its effects. */
export function cardText(card: { text?: string; effects: Effect[] }, registry: OpRegistry, options: TextOptions = {}): string {
  return card.text ?? effectsText(card.effects, registry, options);
}

export function effectsText(effects: Effect[], registry: OpRegistry, options: TextOptions = {}): string {
  return effects
    .map((e) => effectText(e, registry, options))
    .filter((t) => t.length > 0)
    .join(' ');
}

function effectText(effect: Effect, registry: OpRegistry, options: TextOptions): string {
  const meta = registry.get(effect.op);
  if (!meta) return `[${effect.op}]`;
  const { op: _op, ...params } = effect;
  const shown: Record<string, unknown> = { ...params };
  for (const [key, widget] of Object.entries(meta.widgets ?? {})) {
    const value = params[key];
    if (value === undefined || isVarRef(value)) continue;
    if (widget === 'effects') shown[key] = effectsText(value as Effect[], registry, options);
    else if (widget === 'condition') shown[key] = conditionText(value as Condition, options);
    else if (widget === 'direction') shown[key] = directionText(String(value), options);
    else if (REF_WIDGETS.has(widget) && typeof value === 'string') shown[key] = options.name?.(value) ?? value;
  }
  return renderText(meta, shown).trim();
}

export function directionText(dir: string, options: TextOptions = {}): string {
  return (options.topology === 'lane' ? LANE[dir] : COMPASS[dir]) ?? dir;
}

/** A unit stat stored by `readUnit`, as a reader says it: "its HP", "its Rot stacks". */
const STATS: Record<string, string> = { hp: 'HP', maxHp: 'max HP', missing: 'missing HP', block: 'block', statusStacks: 'stacks' };
function varText(path: string, options: TextOptions): string {
  const parts = path.split('.');
  if (parts.length === 2 && STATS[parts[1] as string]) return `its ${STATS[parts[1] as string]}`;
  if (parts.length >= 3 && parts[1] === 'stacks') {
    const status = parts.slice(2).join('.');
    return `its ${options.name?.(status) ?? status} stacks`;
  }
  return 'X';
}

export function conditionText(cond: Condition, options: TextOptions = {}): string {
  const v = (x: unknown) => (isVarRef(x) ? varText(x.$, options) : String(x));
  switch (cond.kind) {
    case 'compare':
      return `${v(cond.left)} ${COMPARE[cond.cmp]} ${v(cond.right)}`;
    case 'truthy':
      return v(cond.value);
    case 'all':
      return cond.of.map((c) => conditionText(c, options)).join(' and ');
    case 'any':
      return cond.of.map((c) => conditionText(c, options)).join(' or ');
    case 'not':
      return `not (${conditionText(cond.cond, options)})`;
  }
}

export function patternText(shape: PatternShapeData, options: TextOptions = {}): string {
  switch (shape.kind) {
    case 'self':
      return 'yourself';
    case 'adjacent':
      return 'adjacent tiles';
    case 'line':
      return `a line of ${shape.length}`;
    case 'cone':
      return options.topology === 'lane' ? `a line of ${shape.length}` : `a cone of ${shape.length}`;
    case 'ring':
      return `tiles exactly ${shape.radius} away`;
    case 'area':
      return `tiles within ${shape.radius}`;
    case 'offsets':
      return 'a pattern';
  }
}

/** A short description of what a card asks the player to choose. */
export function targetingText(t: Targeting | undefined, options: TextOptions = {}): string {
  const range = (r: number | undefined) => (r === undefined ? '' : ` within ${r}`);
  switch (t?.kind ?? 'none') {
    case 'none':
      return '';
    case 'self':
      return 'Targets yourself.';
    case 'unit': {
      const u = t as Extract<Targeting, { kind: 'unit' }>;
      const who = u.filter === 'ally' ? 'an ally' : u.filter === 'enemy' ? 'an enemy' : 'a unit';
      return `Target ${who}${range(u.range)}.`;
    }
    case 'tile': {
      const tile = t as Extract<Targeting, { kind: 'tile' }>;
      return `Target ${tile.empty ? 'an empty tile' : 'a tile'}${range(tile.range)}.`;
    }
    case 'direction':
      return 'Choose a direction.';
    case 'pattern': {
      const p = t as Extract<Targeting, { kind: 'pattern' }>;
      return `Affects ${patternText(p.shape, options)}${range(p.range)}.`;
    }
  }
  return '';
}
