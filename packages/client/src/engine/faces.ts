/** How content looks to players: card faces with generated text (decision #12), shared by the play client and the editor's previews. */
import { buildDefinitions, cardText, targetingText, type CardDef, type Effect } from '@ccg/core';
import type { ContentItem, OpRegistry } from '@ccg/content';
import type { CardFace } from './protocol.js';

export interface FaceOptions {
  /** Topology kind, for direction and area wording. */
  topology?: string;
  /** Display name of a content reference (status, card or unit). */
  name(ref: string): string | undefined;
  /** URL for the card's art path, if it has art. */
  art?(path: string): string | undefined;
}

export function cardFace(item: ContentItem, ops: OpRegistry, options: FaceOptions): CardFace {
  const def = buildDefinitions([item]).cards[item.id] as CardDef;
  const abilities: Record<string, string> = {};
  def.permanent?.abilities?.forEach((a, i) => {
    if (a.kind === 'activated') abilities[i] = a.name;
  });
  const text = { ...(options.topology && { topology: options.topology }), name: options.name };
  const face: CardFace = {
    name: item.name,
    text: cardText(item as unknown as { text?: string; effects: Effect[] }, ops, text),
    targeting: targetingText(def.targeting, options.topology ? { topology: options.topology } : {}),
    cost: def.cost ?? {},
    timing: def.timing ?? 'main',
    keywords: ((item.keywords as string[] | undefined) ?? []).map((k) => options.name(k) ?? k),
    abilities,
  };
  const art = typeof item.art === 'string' ? options.art?.(item.art) : undefined;
  if (art) face.art = art;
  return face;
}
