/**
 * Text contrast in themes (#136): WCAG 2 contrast ratios for the colour pairs
 * a theme puts text on, so the editor can warn below AA (4.5:1).
 */
import type { ContentItem } from '@ccg/content';

/** The client's default (light) tokens, for colours a theme leaves out. */
export const DEFAULT_COLORS: Readonly<Record<string, string>> = {
  page: '#f6f4ef',
  panel: '#ffffff',
  ink: '#1d1c1a',
  muted: '#6b675f',
  accent: '#2f6fb3',
};

/** Text on buttons and cost badges. */
const BADGE_TEXT = '#ffffff';
export const AA = 4.5;

const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return 0.2126 * channel(r as number) + 0.7152 * channel(g as number) + 0.0722 * channel(b as number);
}

/** The contrast ratio between two hex colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export interface ContrastProblem {
  pointer: string;
  message: string;
}

type ThemeFields = {
  colors?: Record<string, string>;
  table?: { color?: string };
  frames?: { id: string; fill?: string; ink?: string; accent?: string }[];
};

/** Every text-on-colour pair in a theme that falls below AA. */
export function themeContrastProblems(theme: ContentItem): ContrastProblem[] {
  const t = theme as ContentItem & ThemeFields;
  const color = (name: string) => t.colors?.[name] ?? (DEFAULT_COLORS[name] as string);
  const out: ContrastProblem[] = [];
  const check = (fg: string, bg: string, pointer: string, what: string) => {
    const ratio = contrast(fg, bg);
    if (ratio < AA) out.push({ pointer, message: `text contrast ${ratio.toFixed(1)}:1 is below ${AA}:1 (WCAG AA): ${what}` });
  };
  check(color('ink'), color('panel'), '/colors/ink', 'text on panels');
  check(color('muted'), color('panel'), '/colors/muted', 'secondary text on panels');
  if (t.table?.color) check(color('ink'), t.table.color, '/table/color', 'text on the table');
  else check(color('ink'), color('page'), '/colors/page', 'text on the page');
  check(BADGE_TEXT, color('accent'), '/colors/accent', 'white text on buttons and cost badges');
  (t.frames ?? []).forEach((f, i) => {
    if (f.ink || f.fill) check(f.ink ?? color('ink'), f.fill ?? color('panel'), `/frames/${i}/${f.ink ? 'ink' : 'fill'}`, `text on frame ${f.id}`);
    if (f.accent) check(BADGE_TEXT, f.accent, `/frames/${i}/accent`, `the cost badge on frame ${f.id}`);
  });
  return out;
}
