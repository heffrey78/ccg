/**
 * Turns loaded content items (@ccg/content) into the static definitions the
 * engine modules take. The content schemas have already validated them.
 */
import type { ContentItem } from '@ccg/content';
import type { Behavior } from './board/intents.js';
import type { StatusDef } from './board/statuses.js';
import type { TileDef, UnitDef } from './board/units.js';
import type { CardDef } from './cards/zones.js';

export interface Definitions {
  cards: Record<string, CardDef>;
  units: Record<string, UnitDef>;
  statuses: Record<string, StatusDef>;
  tiles: Record<string, TileDef>;
}

export function buildDefinitions(items: Iterable<ContentItem>): Definitions {
  const defs: Definitions = { cards: {}, units: {}, statuses: {}, tiles: {} };
  for (const item of items) {
    const { formatVersion: _v, kind, id, name: _n, tags: _t, extensions: _e, ...fields } = item;
    switch (kind) {
      case 'card':
        defs.cards[id] = fields as unknown as CardDef;
        break;
      case 'unit': {
        const { hp, statuses, behavior } = fields as { hp: number; statuses?: { status: string; stacks: number }[]; behavior?: Behavior };
        defs.units[id] = {
          hp,
          ...(statuses && { statuses: Object.fromEntries(statuses.map((s) => [s.status, s.stacks])) }),
          ...(behavior && { behavior }),
        };
        break;
      }
      case 'status':
        defs.statuses[id] = fields as unknown as StatusDef;
        break;
      case 'tile':
        defs.tiles[id] = fields as TileDef;
        break;
      case 'encounter':
        break;
    }
  }
  return defs;
}
