/**
 * Themes (#122, #135): a package's `theme` item, resolved for the client,
 * and which card frame each card gets.
 */
import type { ContentItem } from '@ccg/content';
import type { Theme, ThemeFrame } from './protocol.js';

type ThemeItem = ContentItem & {
  colors?: Record<string, string>;
  fonts?: { body?: { family: string; font?: string }; display?: { family: string; font?: string } };
  table?: { color?: string; background?: string };
  frames?: (Omit<ThemeFrame, 'layout' | 'image'> & { name?: string; layout?: ThemeFrame['layout']; background?: string; match?: { tags?: string[]; rarity?: string[] } })[];
  defaultFrame?: string;
};

/** The theme with its asset paths turned into URLs. */
export function resolveTheme(item: ContentItem, url: (path: string) => string): Theme {
  const t = item as ThemeItem;
  const font = (f: { family: string; font?: string } | undefined) => f && { family: f.family, ...(f.font && { url: url(f.font) }) };
  const body = font(t.fonts?.body);
  const display = font(t.fonts?.display);
  return {
    colors: { ...t.colors },
    fonts: { ...(body && { body }), ...(display && { display }) },
    ...(t.table && { table: { ...(t.table.color && { color: t.table.color }), ...(t.table.background && { image: url(t.table.background) }) } }),
    frames: (t.frames ?? []).map(({ match: _match, background, layout, name: _name, ...rest }) => ({
      ...rest,
      layout: layout ?? 'standard',
      ...(background && { image: url(background) }),
    })),
  };
}

/** A card's frame: the first frame matching one of its tags, else its rarity, else the theme's default. */
export function frameFor(theme: ContentItem, card: ContentItem): string | undefined {
  const frames = (theme as ThemeItem).frames ?? [];
  const tags = (card.tags as string[] | undefined) ?? [];
  const byTag = frames.find((f) => f.match?.tags?.some((t) => tags.includes(t)));
  if (byTag) return byTag.id;
  const rarity = card.rarity as string | undefined;
  const byRarity = rarity === undefined ? undefined : frames.find((f) => f.match?.rarity?.includes(rarity));
  return byRarity?.id ?? (theme as ThemeItem).defaultFrame;
}
