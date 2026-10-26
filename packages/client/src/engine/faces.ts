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
  /** The theme frame for the card (#135). */
  frame?(card: ContentItem): string | undefined;
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
    tags: (item.tags as string[] | undefined) ?? [],
    abilities,
  };
  const art = typeof item.art === 'string' ? options.art?.(item.art) : undefined;
  if (art) face.art = art;
  const frame = options.frame?.(item);
  if (frame) face.frame = frame;
  if (def.upgrade) {
    const upgrade = item.upgrade as { name?: string; cost?: Record<string, number>; effects?: unknown[] };
    const upgraded = {
      ...item,
      name: upgrade.name ?? `${item.name}+`,
      ...(upgrade.cost && { cost: upgrade.cost }),
      ...(upgrade.effects && { effects: upgrade.effects }),
    } as ContentItem;
    const { upgrade: _u, ...rest } = upgraded as ContentItem & { upgrade?: unknown };
    face.upgrade = cardFace(rest as ContentItem, ops, options);
  }
  return face;
}
