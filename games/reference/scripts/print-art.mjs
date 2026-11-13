#!/usr/bin/env node
/**
 * Prints Sporeline's art: turns the flat-vector drawings in `art/` into the block prints in
 * `assets/` that the game ships. Run it after changing a drawing:
 *
 *   node games/reference/scripts/print-art.mjs
 *
 * A block print has few inks, flat colour, shapes that wander where the knife did, specks where
 * the ink didn't take, and colours that sit slightly off the key block. So each drawing loses its
 * gradients, glows and transparency, its colours snap to a small set of inks, its outlines are
 * redrawn a little unevenly, and specks are scattered over it.
 *
 * All of that is done to the shapes themselves. The prints use no SVG filters: Android's webview
 * misdraws filtered SVG images inside the board (the scene covered the screen's top bar, and a
 * unit vanished once it was animated), and filters cost a phone time on every repaint.
 *
 * The output is deterministic: the same drawing always prints the same way.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---- the inks ----
export const PAPER = '#efe3c6';
export const KEY = '#1f1812';
const EARTH = '#2c2018';
const UMBER = '#6e4a2c';
/** One ink per strain, named as the card tags are. */
export const INKS = { knot: '#d0902a', rotcap: '#6f8f2e', puffball: '#2f8f84', glowcap: '#7a5cc4', rootdrinker: '#3277b5', cordyceps: '#c2512d' };
const ALL_INKS = [...Object.values(INKS), UMBER];

const rgb = (hex) => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};
const luminance = (hex) => {
  const [r, g, b] = rgb(hex).map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const hsl = (hex) => {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  const h = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
};
const mix = (a, b, t) => `#${rgb(a).map((v, i) => Math.round(v + (rgb(b)[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
const hueGap = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/** The ink a drawing's colour prints in: paper for the lightest, the key block for the darkest, else the nearest ink by hue. */
function inkFor(color, inks, { dark = KEY } = {}) {
  const lum = luminance(color);
  const [h, s] = hsl(color);
  if (lum < 0.035) return dark;
  if (s < 0.2) return lum > 0.45 ? PAPER : lum < 0.12 ? dark : UMBER;
  if (lum > 0.6 && s < 0.85) return PAPER;
  let best = inks[0];
  for (const ink of inks) if (hueGap(hsl(ink)[0], h) < hueGap(hsl(best)[0], h)) best = ink;
  // A dull dark brown is the wood showing, not a colour.
  if (lum < 0.1 && s < 0.6) return inks.includes(UMBER) ? UMBER : dark;
  return best;
}

/** A small seeded generator, so prints never change between runs. */
function seeded(text) {
  let a = 2166136261;
  for (const c of text) a = Math.imul(a ^ c.charCodeAt(0), 16777619);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const n1 = (v) => Number(v.toFixed(1));

const attr = (tag, name) => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag)?.[1];
const without = (tag, names) => names.reduce((t, name) => t.replace(new RegExp(`\\s${name}="[^"]*"`, 'g'), ''), tag);

/**
 * The drawing's shapes, flattened for printing. `pick` chooses the ink for a colour; `offset`
 * moves the coloured inks off the key block, as a second pass through the press does.
 */
function flatten(svg, { pick, offset, random, scale, wander }) {
  const gradients = {};
  const overlays = new Set();
  for (const [, id, stops] of svg.matchAll(/<(?:linear|radial)Gradient id="([^"]+)"[^>]*>(.*?)<\/(?:linear|radial)Gradient>/g)) {
    const colors = [...stops.matchAll(/stop-color="([^"]+)"/g)].map((m) => m[1]);
    gradients[id] = colors[0];
    // A gradient that fades to nothing is light or shadow laid over the drawing; print has neither.
    if (/stop-opacity="0?(\.0+)?"/.test(stops)) overlays.add(id);
  }
  let body = svg.replace(/<defs>.*?<\/defs>/, '').replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  let first = true;
  body = body.replace(/<(path|circle|ellipse|rect|line|polygon|polyline|g)\b([^>]*?)(\/?)>/g, (whole, name, attrs, close) => {
    let tag = attrs;
    const soft = /filter="url\(#soft\)"/.test(tag);
    const opacity = Number(attr(tag, 'opacity') ?? 1) * Number(attr(tag, 'fill-opacity') ?? attr(tag, 'stroke-opacity') ?? 1);
    const paint = (value) => {
      if (!value || value === 'none') return value;
      const url = /^url\(#(.+)\)$/.exec(value)?.[1];
      if (url) return overlays.has(url) ? null : pick(gradients[url] ?? '#000');
      return pick(value.length === 4 || value.length === 7 ? value : '#000');
    };
    // The first full rectangle is the drawing's ground; the print lays its own.
    if (name === 'rect' && first && !attr(tag, 'x') && !attr(tag, 'y')) {
      first = false;
      return '';
    }
    first = false;
    const fill = paint(attr(tag, 'fill'));
    const stroke = paint(attr(tag, 'stroke'));
    if (name !== 'g') {
      if (fill === null || stroke === null) return '';
      // A soft glow becomes cut rays; other faint shapes don't print at all.
      if (soft && opacity < 0.3 && name === 'circle' && Number(attr(tag, 'r')) >= 20) {
        const [cx, cy, r] = ['cx', 'cy', 'r'].map((k) => Number(attr(tag, k)));
        const rays = [];
        const count = 22;
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2 + random() * 0.12;
          const from = r * (0.62 + random() * 0.12);
          const to = r * (0.95 + random() * 0.2);
          rays.push(`M${n1(cx + Math.cos(a) * from)} ${n1(cy + Math.sin(a) * from)}L${n1(cx + Math.cos(a) * to)} ${n1(cy + Math.sin(a) * to)}`);
        }
        return `<path d="${rays.join('')}" stroke="${fill}" stroke-width="${n1(1.4 * scale)}" stroke-linecap="round" fill="none"/>`;
      }
      if (opacity < 0.3) return '';
    }
    tag = without(tag, ['filter', 'opacity', 'fill-opacity', 'stroke-opacity']);
    // The knife wanders: outlines are redrawn a little off true.
    let shape = name;
    if (name === 'path') tag = tag.replace(/(\s)d="([^"]*)"/, (_, space, d) => `${space}d="${wobble(d, random, wander)}"`);
    if (name === 'circle' || name === 'ellipse') {
      const cx = Number(attr(tag, 'cx') ?? 0);
      const cy = Number(attr(tag, 'cy') ?? 0);
      const rx = Number(attr(tag, name === 'circle' ? 'r' : 'rx'));
      const ry = Number(attr(tag, name === 'circle' ? 'r' : 'ry'));
      if (Math.min(rx, ry) > wander * 3) {
        tag = `${without(tag, ['cx', 'cy', 'r', 'rx', 'ry'])} d="${blob(cx, cy, rx, ry, random, wander)}"`;
        shape = 'path';
      }
    }
    if (fill !== undefined) tag = tag.replace(/(\s)fill="[^"]*"/, `$1fill="${fill}"`);
    if (stroke !== undefined) tag = tag.replace(/(\s)stroke="[^"]*"/, `$1stroke="${stroke}"`);
    // Hairlines fill in on the press: nothing prints thinner than a cut can be.
    const width = attr(tag, 'stroke-width');
    if (width !== undefined && Number(width) < 1.1 * scale) tag = tag.replace(/(\s)stroke-width="[^"]*"/, `$1stroke-width="${n1(1.1 * scale)}"`);
    const coloured = [fill, stroke].some((c) => c && c !== 'none' && c !== PAPER && c !== KEY && c !== EARTH);
    if (offset && coloured && name !== 'g') {
      const existing = attr(tag, 'transform');
      tag = existing ? tag.replace(/(\s)transform="[^"]*"/, `$1transform="translate(${offset}) ${existing}"`) : `${tag} transform="translate(${offset})"`;
    }
    return `<${shape}${tag}${close}>`;
  });
  return body;
}

/** A path with every point nudged, as a hand-cut line is. Arcs keep their flags, so they are left as drawn. */
function wobble(d, random, amount) {
  if (!amount) return d;
  return d.replace(/([MLQCSTHVmlqcsthv])([^A-Za-z]*)/g, (_, command, args) => `${command}${args.replace(/-?\d*\.?\d+(?:e-?\d+)?/g, (n) => String(n1(Number(n) + (random() - 0.5) * 2 * amount)))}`);
}

/** A circle or ellipse cut by hand: a closed curve through points that sit a little in or out of true. */
function blob(cx, cy, rx, ry, random, amount) {
  const count = 9;
  const turn = random() * Math.PI * 2;
  const pts = Array.from({ length: count }, (_, i) => {
    const a = turn + (i / count) * Math.PI * 2;
    const out = 1 + ((random() - 0.5) * 2 * amount) / Math.max(rx, ry) + (random() - 0.5) * 0.06;
    return [cx + Math.cos(a) * rx * out, cy + Math.sin(a) * ry * out];
  });
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const at = (i) => pts[i % count];
  const start = mid(at(0), at(1));
  let d = `M${n1(start[0])} ${n1(start[1])}`;
  for (let i = 1; i <= count; i++) {
    const m = mid(at(i), at(i + 1));
    d += `Q${n1(at(i)[0])} ${n1(at(i)[1])} ${n1(m[0])} ${n1(m[1])}`;
  }
  return `${d}Z`;
}

/** Where the ink didn't take: specks of bare paper (or, on a ground, of the block below), mostly dots, some dragged a little. */
function specks(w, h, random, count, color, scale) {
  const dots = [];
  const drags = [];
  for (let i = 0; i < count; i++) {
    const x = n1(random() * w);
    const y = n1(random() * h);
    const r = (0.25 + random() * random() * 0.9) * scale;
    if (random() < 0.8) dots.push(`M${x} ${y}m${n1(-r)} 0a${n1(r)} ${n1(r)} 0 1 0 ${n1(r * 2)} 0a${n1(r)} ${n1(r)} 0 1 0 ${n1(-r * 2)} 0`);
    else drags.push(`M${x} ${y}l${n1((random() - 0.3) * 4 * scale)} ${n1((random() - 0.5) * 1.6 * scale)}`);
  }
  return `<path d="${dots.join('')}" fill="${color}"/><path d="${drags.join('')}" stroke="${color}" stroke-width="${n1(0.6 * scale)}" stroke-linecap="round" fill="none"/>`;
}

/** The figure's shapes again, fattened and in bare paper: laid under the figure, they leave a rim around it. */
function rim(body, width) {
  return body.replace(/<(path|circle|ellipse|rect|line|polygon|polyline)\b([^>]*?)\/>/g, (_, name, attrs) => {
    let tag = attrs;
    const fill = attr(tag, 'fill');
    const stroke = attr(tag, 'stroke');
    const own = stroke && stroke !== 'none' ? Number(attr(tag, 'stroke-width') ?? 1) : 0;
    tag = without(tag, ['fill', 'stroke', 'stroke-width', 'stroke-linejoin']);
    return `<${name}${tag} fill="${fill === 'none' ? 'none' : PAPER}" stroke="${PAPER}" stroke-width="${n1(own + width * 2)}" stroke-linejoin="round"/>`;
  });
}

/** A block's edge: a rectangle whose sides wander, as a hand-cut block's do. */
function block(x, y, w, h, random, wander) {
  const pts = [];
  const side = (x0, y0, x1, y1, steps) => {
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      pts.push([x0 + (x1 - x0) * t + (random() - 0.5) * wander, y0 + (y1 - y0) * t + (random() - 0.5) * wander]);
    }
  };
  side(x, y, x + w, y, 9);
  side(x + w, y, x + w, y + h, 7);
  side(x + w, y + h, x, y + h, 9);
  side(x, y + h, x, y, 7);
  return `M${pts.map(([px, py]) => `${n1(px)} ${n1(py)}`).join('L')}Z`;
}

/** Short ridges the gouge left standing in the cleared ground: the marks that say a block was cut by hand. */
function chatter(w, h, random, count, color, scale) {
  const marks = [];
  for (let i = 0; i < count; i++) {
    const x = random() * w;
    const y = random() * h;
    const a = -0.5 + random() * 0.35;
    const len = (3 + random() * 6) * scale;
    marks.push(`M${n1(x)} ${n1(y)}l${n1(Math.cos(a) * len)} ${n1(Math.sin(a) * len)}`);
  }
  return `<path d="${marks.join('')}" stroke="${color}" stroke-width="${n1(0.9 * scale)}" stroke-linecap="round" fill="none"/>`;
}

const header = (svg) => {
  const [, , , w, h] = /viewBox="(\S+) (\S+) (\S+) (\S+)"/.exec(svg).map(Number);
  const aspect = /preserveAspectRatio="([^"]+)"/.exec(svg)?.[1] ?? 'xMidYMid meet';
  return { w, h, aspect };
};
const wrap = ({ w, h, aspect }, inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="${aspect}">${inner}</svg>\n`;

/** A card: the key block with the picture cut out of it, and the card's strains printed in their inks. */
function printCard(name, svg, strains) {
  const random = seeded(name);
  const size = header(svg);
  const inks = strains.map((s) => INKS[s]).filter(Boolean);
  if (inks.length === 0) inks.push(INKS.knot);
  const body = flatten(svg, { pick: (c) => inkFor(c, inks), offset: '0.9 -0.7', random, scale: 1, wander: 0.7 });
  const edge = block(3, 3, size.w - 6, size.h - 6, random, 2);
  return wrap(
    size,
    `<defs><clipPath id="block"><path d="${edge}"/></clipPath></defs>` +
      `<g clip-path="url(#block)"><rect width="${size.w}" height="${size.h}" fill="${KEY}"/>${chatter(size.w, size.h, random, 46, inks[0], 1)}${body}${specks(size.w, size.h, random, 80, PAPER, 1)}</g>`,
  );
}

/** A unit: a figure cut out and inked, with a rim of bare paper around it, so it reads on any ground. */
function printUnit(name, svg) {
  const random = seeded(name);
  const size = header(svg);
  const body = flatten(svg, { pick: (c) => inkFor(c, ALL_INKS), random, scale: 0.8, wander: 0.6 });
  return wrap(size, `<g transform="translate(${size.w * 0.04} ${size.h * 0.04}) scale(0.92)">${rim(body, 1.7)}${body}</g>`);
}

/** A scene or the table: earth-coloured ground, printed edge to edge, so the board and its units stay readable on it. */
function printGround(name, svg, { marks, dim, flecks, markInk = UMBER }) {
  // On a ground the inks are thinned, so what stands on it is always the brightest thing there.
  const thin = (ink) => (ink === KEY || ink === EARTH ? ink : mix(ink, EARTH, dim));
  const random = seeded(name);
  const size = header(svg);
  const unit = size.w / 400;
  const body = flatten(svg, { pick: (c) => thin(inkFor(c, ALL_INKS, { dark: KEY })), random, scale: unit, wander: unit * 0.9 });
  return wrap(
    size,
    `<rect width="${size.w}" height="${size.h}" fill="${EARTH}"/>${chatter(size.w, size.h, random, marks, thin(markInk), unit * 1.3)}${body}${specks(size.w, size.h, random, flecks, KEY, unit * 1.5)}`,
  );
}

/** The card stock: cream paper with its fibres and flecks, stretched over a card face. */
function paper() {
  const random = seeded('paper');
  const w = 240;
  const h = 320;
  // Mottling: a few broad, faint patches where the stock is a shade darker.
  const patches = Array.from({ length: 7 }, () => `<ellipse cx="${n1(random() * w)}" cy="${n1(random() * h)}" rx="${n1(50 + random() * 60)}" ry="${n1(40 + random() * 70)}" fill="url(#patch)"/>`).join('');
  // Fibres and flecks pressed into the sheet.
  const fibres = Array.from({ length: 46 }, () => {
    const x = random() * w;
    const y = random() * h;
    const a = random() * Math.PI;
    const len = 3 + random() * 7;
    return `M${n1(x)} ${n1(y)}q${n1(Math.cos(a) * len * 0.5 + (random() - 0.5) * 2)} ${n1(Math.sin(a) * len * 0.5 + (random() - 0.5) * 2)} ${n1(Math.cos(a) * len)} ${n1(Math.sin(a) * len)}`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none"><defs><radialGradient id="patch"><stop offset="0" stop-color="#8a6a3a" stop-opacity="0.13"/><stop offset="1" stop-color="#8a6a3a" stop-opacity="0"/></radialGradient></defs><rect width="${w}" height="${h}" fill="${PAPER}"/>${patches}<path d="${fibres}" stroke="#8a6a3a" stroke-opacity="0.28" stroke-width="0.5" stroke-linecap="round" fill="none"/><g opacity="0.5">${specks(w, h, random, 150, '#6b4a26', 0.9)}</g></svg>\n`;
}

function strainsOf(card) {
  try {
    return JSON.parse(readFileSync(join(root, 'content/cards', `${card}.json`), 'utf8')).tags ?? [];
  } catch {
    return [];
  }
}

const jobs = [
  ['cards', (name, svg) => printCard(name, svg, strainsOf(name))],
  ['units', printUnit],
  ['scenes', (name, svg) => printGround(name, svg, { marks: 150, dim: 0.45, flecks: 380 })],
  ['theme', (name, svg) => printGround(name, svg, { marks: 260, dim: 0.88, flecks: 1100 })],
];
/** Every printed file, by its path in the package: what `assets/` should hold for the drawings in `art/`. */
export function prints() {
  const out = {};
  for (const [folder, print] of jobs) {
    for (const file of readdirSync(join(root, 'art', folder)).filter((f) => f.endsWith('.svg')).sort()) {
      out[`assets/${folder}/${file}`] = print(file.replace(/\.svg$/, ''), readFileSync(join(root, 'art', folder, file), 'utf8').trim());
    }
  }
  out['assets/theme/paper.svg'] = paper();
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = prints();
  for (const [path, svg] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), svg);
  }
  console.log(`printed ${Object.keys(files).length} files into assets/`);
}
