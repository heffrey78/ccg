/**
 * Deterministic ordering of listeners that fire together (§6.3): event order,
 * then source layer, then controller (active side first, then turn order),
 * then timestamp. Listener id breaks any remaining tie so the order is total.
 */
import type { ListenerLayer, SideId } from './types.js';

const LAYER_RANK: Record<ListenerLayer, number> = {
  rules: 0,
  status: 1,
  permanent: 2,
  innate: 3,
  card: 4,
};

interface OrderKeys {
  id: string;
  layer: ListenerLayer;
  controller: SideId | null;
  timestamp: number;
}

export interface Ordered<L extends OrderKeys> {
  listener: L;
  /** Index of the matching event within the action; 0 for modifiers. */
  eventIndex: number;
}

/** Controller rank: rules first, then sides starting with the active side. */
export function controllerRanker(
  sideOrder: readonly SideId[],
  activeSide: SideId | null,
): (controller: SideId | null) => number {
  const start = activeSide === null ? 0 : Math.max(0, sideOrder.indexOf(activeSide));
  return (controller) => {
    if (controller === null) return -1;
    const index = sideOrder.indexOf(controller);
    if (index < 0) return sideOrder.length;
    return (index - start + sideOrder.length) % sideOrder.length;
  };
}

export function sortListeners<T extends Ordered<OrderKeys>>(
  entries: readonly T[],
  rankController: (controller: SideId | null) => number,
): T[] {
  return entries.slice().sort(
    (a, b) =>
      a.eventIndex - b.eventIndex ||
      LAYER_RANK[a.listener.layer] - LAYER_RANK[b.listener.layer] ||
      rankController(a.listener.controller) - rankController(b.listener.controller) ||
      a.listener.timestamp - b.listener.timestamp ||
      (a.listener.id < b.listener.id ? -1 : a.listener.id > b.listener.id ? 1 : 0),
  );
}
