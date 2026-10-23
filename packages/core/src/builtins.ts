/**
 * The engine's built-in op vocabulary. Op metadata does not depend on module
 * configuration, so the modules are instantiated with placeholder config just
 * to read it.
 */
import type { OpRegistry } from '@ccg/content';
import { LaneTopology } from './board/lane.js';
import { intentsModule } from './board/intents.js';
import { permanentsModule } from './board/permanents.js';
import { statusesModule } from './board/statuses.js';
import { boardModule } from './board/units.js';
import { zonesModule } from './cards/zones.js';
import { describeOps } from './rules/compose.js';
import { logicModule } from './rules/logic.js';

/** Metadata for every built-in op, for content validation, card text and the editor. */
export function builtinOps(): OpRegistry {
  return describeOps<never>([
    zonesModule({}) as never,
    boardModule({ topology: new LaneTopology(1) }) as never,
    statusesModule({}) as never,
    intentsModule({ topology: new LaneTopology(1), behaviors: {} }) as never,
    permanentsModule({ topology: new LaneTopology(1), cards: {}, units: {} }) as never,
    logicModule(),
  ]);
}
