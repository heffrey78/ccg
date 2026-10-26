/**
 * A game's theme as CSS (#135): colour tokens, fonts, the table and card
 * frames, scoped to one element so a game without a theme looks as before.
 * Colours and ids are validated by the content schema; font names allow only
 * letters, digits, spaces, - and _; URLs are quoted.
 */
import type { Theme, ThemeFrame } from '../engine/protocol.js';

const TOKENS: Record<string, string> = {
  page: '--bg',
  panel: '--panel',
  ink: '--ink',
  muted: '--muted',
  line: '--line',
  accent: '--accent',
  accentText: '--accent-text',
  cell: '--cell',
  mine: '--mine',
  enemy: '--enemy',
  threat: '--threat',
  hp: '--hp',
  block: '--block',
  reaction: '--reaction',
  target: '--target',
};

const quote = (url: string) => `url("${url.replace(/["\\\n]/g, '')}")`;

/** How a frame's layout rearranges the card face. */
function layoutCss(sel: string, layout: ThemeFrame['layout']): string {
  if (layout === 'art-first')
    return `${sel} { overflow: hidden; }
${sel} .ccg-card-art { order: -1; margin: -8px -8px 0; width: calc(100% + 16px); max-width: none; border-radius: 0; }`;
  if (layout === 'full-art')
    return `${sel} { overflow: hidden; justify-content: flex-end; padding-top: 34px; }
${sel} .ccg-card-art { position: absolute; inset: 0; width: 100%; height: 100%; aspect-ratio: auto; border-radius: 0; }
${sel} .ccg-card-top { position: absolute; top: 0; left: 0; right: 0; padding: 6px 8px; }
${sel} .ccg-card-top, ${sel} .ccg-card-text, ${sel} .ccg-card-tags { z-index: 1; background: color-mix(in srgb, var(--card-fill, var(--panel)) 84%, transparent); }
${sel} .ccg-card-text, ${sel} .ccg-card-tags { position: relative; margin: 0 -8px; padding: 4px 8px; }
${sel} .ccg-card-tags { margin-bottom: -8px; }
${sel} .ccg-card-key { z-index: 1; }`;
  return '';
}

function frameCss(scope: string, f: ThemeFrame): string {
  const sel = `${scope} .ccg-card[data-frame="${f.id}"]`;
  const face = [
    f.fill && `--card-fill: ${f.fill}; background-color: ${f.fill};`,
    f.image && `background-image: ${quote(f.image)}; background-size: 100% 100%;`,
    f.border && `border-color: ${f.border};`,
    f.borderWidth !== undefined && `border-width: ${f.borderWidth}px; border-style: solid;`,
    f.radius !== undefined && `border-radius: ${f.radius}px;`,
    f.ink && `color: ${f.ink};`,
  ]
    .filter(Boolean)
    .join(' ');
  return [face && `${sel} { ${face} }`, f.accent && `${sel} .ccg-card-cost { background: ${f.accent}; }`, layoutCss(sel, f.layout)].filter(Boolean).join('\n');
}

/** CSS for a theme, applied inside `scope` (and to the page around it, so the table fills the window). */
export function themeCss(theme: Theme, scope: string): string {
  const tokens = Object.entries(theme.colors)
    .flatMap(([name, value]) => (TOKENS[name] ? [`${TOKENS[name]}: ${value};`] : []))
    .join(' ');
  const page = `.ccg-app:has(${scope})`;
  const out: string[] = [];
  const family = (role: 'body' | 'display') => {
    const font = theme.fonts[role];
    if (!font) return null;
    if (font.url) out.push(`@font-face { font-family: "ccg-${role}"; src: ${quote(font.url)}; font-display: swap; }`);
    return `${font.url ? `"ccg-${role}", ` : ''}"${font.family}", system-ui, sans-serif`;
  };
  const body = family('body');
  const display = family('display');
  const table = [theme.table?.color && `background-color: ${theme.table.color};`, theme.table?.image && `background-image: ${quote(theme.table.image)}; background-size: cover; background-position: center; background-attachment: fixed;`]
    .filter(Boolean)
    .join(' ');
  if (tokens) out.push(`${page}, ${scope} { ${tokens} }`, `${page} { background-color: var(--bg); }`);
  if (table) out.push(`${page}, .ccg-encounter.is-view-full${scope} { ${table} }`);
  if (body) out.push(`${scope} { font-family: ${body}; }`);
  if (display) out.push(`${scope} h1, ${scope} h2, ${scope} .ccg-card-name, ${scope} .ccg-banner { font-family: ${display}; }`);
  for (const frame of theme.frames) out.push(frameCss(scope, frame));
  return out.filter(Boolean).join('\n');
}
