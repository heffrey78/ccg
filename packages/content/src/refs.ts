/**
 * One walker for every content reference in an item: effect parameters whose
 * widget names a definition (via op metadata), keywords, unit statuses,
 * behaviour-tree intents, permanents and encounter fields. The registry uses
 * it to qualify ids; the editor uses it to find and rename references.
 */
import type { OpRegistry } from './ops.js';
import type { ContentItem, ContentKind } from './schemas.js';

/** Widgets whose parameter values reference definitions, by content kind. */
export const REF_WIDGETS: Readonly<Record<string, ContentKind>> = { status: 'status', cardDef: 'card', unitDef: 'unit' };

/**
 * Called for each reference with its kind and JSON Pointer; return a new value
 * to replace it, or undefined to keep it.
 */
export type RefVisitor = (kind: ContentKind, ref: string, pointer: string) => string | undefined | void;

const isVarRef = (value: unknown) => typeof value === 'object' && value !== null && '$' in value;

/** Visits (and optionally rewrites, in place) every reference in an item. */
export function mapRefs(item: ContentItem, ops: OpRegistry, visit: RefVisitor): ContentItem {
  const ref = (kind: ContentKind, value: string, pointer: string): string => visit(kind, value, pointer) ?? value;
  const effects = (list: unknown, pointer: string) => {
    if (Array.isArray(list)) list.forEach((e, i) => effect(e as Record<string, unknown>, `${pointer}/${i}`));
  };
  const effect = (e: Record<string, unknown>, pointer: string) => {
    const meta = ops.get(e.op as string);
    for (const [key, widget] of Object.entries(meta?.widgets ?? {})) {
      const value = e[key];
      if (value === undefined || isVarRef(value)) continue;
      const kind = REF_WIDGETS[widget];
      if (kind && typeof value === 'string') e[key] = ref(kind, value, `${pointer}/${key}`);
      else if (widget === 'effects') effects(value, `${pointer}/${key}`);
    }
  };

  const f = item as Record<string, unknown> & ContentItem;
  switch (item.kind) {
    case 'card': {
      effects(f.effects, '/effects');
      effects((f.upgrade as { effects?: unknown } | undefined)?.effects, '/upgrade/effects');
      const keywords = f.keywords as string[] | undefined;
      if (keywords) f.keywords = keywords.map((k, i) => ref('status', k, `/keywords/${i}`));
      const permanent = f.permanent as { unit?: string; abilities?: { effects: unknown }[] } | undefined;
      if (permanent?.unit) permanent.unit = ref('unit', permanent.unit, '/permanent/unit');
      permanent?.abilities?.forEach((a, i) => effects(a.effects, `/permanent/abilities/${i}/effects`));
      break;
    }
    case 'unit': {
      for (const [i, s] of ((f.statuses as { status: string }[] | undefined) ?? []).entries()) {
        s.status = ref('status', s.status, `/statuses/${i}/status`);
      }
      // Behaviour trees hold intents, whose effects reference content too.
      const walk = (node: unknown, pointer: string): void => {
        if (typeof node !== 'object' || node === null) return;
        const n = node as Record<string, unknown>;
        if (n.kind === 'intent') effects((n.intent as { effects?: unknown }).effects, `${pointer}/intent/effects`);
        if (Array.isArray(n.steps)) n.steps.forEach((step, i) => walk(step, `${pointer}/steps/${i}`));
        if (Array.isArray(n.options)) n.options.forEach((o, i) => walk((o as { then: unknown }).then, `${pointer}/options/${i}/then`));
        if (n.kind === 'if') {
          walk(n.then, `${pointer}/then`);
          walk(n.else, `${pointer}/else`);
        }
      };
      walk(f.behavior, '/behavior');
      break;
    }
    case 'status':
      for (const [i, hook] of ((f.hooks as { effects: unknown }[] | undefined) ?? []).entries()) effects(hook.effects, `/hooks/${i}/effects`);
      break;
    case 'tile':
      effects(f.onEnter, '/onEnter');
      break;
    case 'encounter': {
      for (const [i, u] of (f.units as { unit: string }[]).entries()) u.unit = ref('unit', u.unit, `/units/${i}/unit`);
      const tiles = f.tiles as Record<string, string> | undefined;
      if (tiles) for (const pos of Object.keys(tiles)) tiles[pos] = ref('tile', tiles[pos] as string, `/tiles/${pos.replace(/~/g, '~0').replace(/\//g, '~1')}`);
      const rewards = f.rewards as { cards?: string[] } | undefined;
      if (rewards?.cards) rewards.cards = rewards.cards.map((c, i) => ref('card', c, `/rewards/cards/${i}`));
      break;
    }
    case 'scenario': {
      f.encounter = ref('encounter', f.encounter as string, '/encounter');
      for (const field of ['hand', 'deck'] as const) {
        const list = f[field] as string[] | undefined;
        if (list) f[field] = list.map((c, i) => ref('card', c, `/${field}/${i}`));
      }
      break;
    }
    case 'ruleset': {
      const player = f.player as { deck: string[] };
      player.deck = player.deck.map((c, i) => ref('card', c, `/player/deck/${i}`));
      break;
    }
  }
  return item;
}
