/**
 * The generic SVG board: draws any topology that has a layout (lane, square,
 * hex) with its tiles, units, telegraphed intents and the current choices.
 * Games with an unusual board can pass their own renderer by topology kind.
 */
import type { KeyboardEvent, ReactNode } from 'react';
import type { IntentSummary } from '../../engine/protocol.js';
import type { ShownUnit } from './playback.js';
import type { IntentView, Layout } from './world.js';

/** One clickable highlight on the board. */
export interface BoardTarget {
  cell: string;
  label: string;
  /** Whether the target is the unit standing on the cell (drawn as a ring) or the tile. */
  onUnit: boolean;
  focused: boolean;
  onPick(): void;
}

/** A permanent drawn on the board: an aura on its tile, or an attachment on its host. */
export interface BoardMarker {
  id: string;
  label: string;
  kind: string;
  pos?: string;
  host?: string;
  mine: boolean;
}

/** A floating label over a unit for the beat that is playing. */
export interface BoardEffect {
  unit: string;
  text: string;
  tone: 'damage' | 'block' | 'heal' | 'status' | 'info';
}

export interface BoardProps {
  layout: Layout;
  units: Record<string, ShownUnit>;
  tiles: Record<string, string>;
  side: string;
  intents: IntentView[];
  intentSummaries: Record<string, IntentSummary>;
  names: Record<string, string>;
  targets: BoardTarget[];
  effect: BoardEffect | null;
  /** Units the player can select (to move or activate). */
  selectable: Set<string>;
  selected: string | null;
  onUnit(unit: string): void;
  onInspect(unit: string | null): void;
  /** Animation speed multiplier for CSS transitions; 0 disables them. */
  speed: number;
  /** Under fog of war, the tiles the player can see; undefined without fog. */
  vision?: string[] | undefined;
  /** Auras and attachments to draw. */
  markers?: BoardMarker[];
  /** Sprite and tile art URLs by content id; units and tiles without art are drawn as shapes. */
  art?: Record<string, string>;
  /** The scene behind the board. */
  background?: string | undefined;
}

export type BoardRenderer = (props: BoardProps) => ReactNode;

const CELL = 80;
const SQRT3 = Math.sqrt(3);

function hexPoints(r: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    return `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`;
  }).join(' ');
}

const activate = (fn: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fn();
  }
};

export function Board(props: BoardProps) {
  const { layout, units, tiles, side, intents, intentSummaries, names, targets, effect, selectable, selected, speed, vision, markers = [], art = {}, background } = props;
  const seen = vision ? new Set(vision) : null;
  const hex = layout.cell === 'hex';
  // Cell centres are ~1 apart; a hex's circumradius is 1/√3 of that.
  const radius = hex ? CELL / SQRT3 : CELL / 2;
  const at = new Map(layout.cells.map((c) => [c.pos, { x: c.x * CELL, y: c.y * CELL }]));
  const xs = layout.cells.map((c) => c.x * CELL);
  const ys = layout.cells.map((c) => c.y * CELL);
  const pad = radius + 28;
  const wide = { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 };
  // A long thin board (a lane) gets room above and below, so the scene shows and the board isn't a sliver.
  const minHeight = wide.w / 2.6;
  const box = wide.h >= minHeight ? wide : { ...wide, y: wide.y - (minHeight - wide.h) / 2, h: minHeight };
  const name = (id: string) => names[id] ?? id;

  // Cells an enemy attack threatens: its tile or unit target, or its pattern.
  const threatened = new Set<string>();
  for (const i of intents) {
    if (i.side === side || !intentSummaries[i.id]?.damage) continue;
    for (const c of i.cells ?? []) threatened.add(c);
    if (i.bound === 'tile' && i.target) threatened.add(i.target);
    if (i.bound === 'unit' && i.target) {
      const pos = units[i.target]?.pos;
      if (pos) threatened.add(pos);
    }
  }
  const intentByUnit = new Map(intents.map((i) => [i.unit, i]));
  const transition = speed > 0 ? `transform ${Math.round(200 / speed)}ms ease-out, opacity ${Math.round(300 / speed)}ms` : 'none';

  return (
    <svg
      className="ccg-board"
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      role="group"
      aria-label={`${layout.kind} board`}
      style={{ width: '100%', maxHeight: '56vh' }}
    >
      {background && <image className="ccg-scene" href={background} x={box.x} y={box.y} width={box.w} height={box.h} preserveAspectRatio="xMidYMid slice" />}
      <g className={background ? 'has-scene' : undefined}>
        {layout.cells.map((c) => {
          const p = at.get(c.pos)!;
          const tile = tiles[c.pos];
          const blocking = tile !== undefined && layout.tiles[tile]?.blocking === true;
          const fogged = seen !== null && !seen.has(c.pos);
          const cls = ['ccg-cell', blocking && 'is-blocking', tile && !blocking && 'is-special', threatened.has(c.pos) && 'is-threatened', fogged && 'is-fogged'].filter(Boolean).join(' ');
          return (
            <g key={c.pos} transform={`translate(${p.x} ${p.y})`}>
              {hex ? (
                <polygon className={cls} points={hexPoints(radius - 2)} />
              ) : (
                <rect className={cls} x={-radius + 2} y={-radius + 2} width={radius * 2 - 4} height={radius * 2 - 4} rx={6} />
              )}
              {tile && art[tile] && <image href={art[tile]} x={-radius + 2} y={-radius + 2} width={radius * 2 - 4} height={radius * 2 - 4} preserveAspectRatio="xMidYMid slice" />}
              {tile && !art[tile] && <text className="ccg-tile-label" y={radius - 8} textAnchor="middle">{name(tile)}</text>}
              <title>{[c.pos, tile && name(tile), fogged && 'out of sight'].filter(Boolean).join(' · ')}</title>
            </g>
          );
        })}
      </g>

      <g>
        {markers
          .filter((m) => m.pos !== undefined && at.has(m.pos))
          .map((m) => {
            const p = at.get(m.pos as string)!;
            return (
              <g key={m.id} className={['ccg-aura', m.mine ? 'is-mine' : 'is-enemy'].join(' ')} transform={`translate(${p.x} ${p.y})`} data-permanent={m.id} aria-label={`${m.label} (${m.kind}) on ${m.pos}`} role="img">
                <circle r={radius * 0.88} />
                <text y={-radius * 0.68} textAnchor="middle">{m.label}</text>
              </g>
            );
          })}
      </g>

      <g>
        {Object.values(units).map((u) => {
          const p = at.get(u.pos);
          if (!p) return null;
          const mine = u.side === side;
          const neutral = u.side === 'neutral';
          const intent = intentByUnit.get(u.id);
          const summary = intent ? intentSummaries[intent.id] : undefined;
          const dir = layout.directions[u.facing];
          const canSelect = selectable.has(u.id);
          const label = `${name(u.def)}, ${mine ? 'yours' : neutral ? 'neutral' : 'enemy'}, ${u.hp} of ${u.maxHp} HP${u.block ? `, ${u.block} block` : ''}${intent ? `, intends ${intent.name ?? 'something'}` : ''}`;
          return (
            <g
              key={u.id}
              className={['ccg-unit', mine ? 'is-mine' : neutral ? 'is-neutral' : 'is-enemy', u.passable && 'is-passable', u.dying && 'is-dying', selected === u.id && 'is-selected'].filter(Boolean).join(' ')}
              style={{ transform: `translate(${p.x}px, ${p.y}px)`, transition }}
              onMouseEnter={() => props.onInspect(u.id)}
              onMouseLeave={() => props.onInspect(null)}
              onFocus={() => props.onInspect(u.id)}
              onClick={() => props.onUnit(u.id)}
              {...(canSelect && { role: 'button', tabIndex: 0, onKeyDown: activate(() => props.onUnit(u.id)) })}
              aria-label={label}
              data-unit={u.id}
              data-pos={u.pos}
            >
              {art[u.def] ? (
                <>
                  <ellipse className="ccg-unit-ground" cy={radius * 0.32} rx={radius * 0.62} ry={radius * 0.16} />
                  <image
                    className="ccg-unit-sprite"
                    href={art[u.def]}
                    x={-radius * 0.78}
                    y={-radius * 0.98}
                    width={radius * 1.56}
                    height={radius * 1.56}
                    // Sprites face east; units facing west are mirrored.
                    {...(dir && dir.x < -0.01 && { transform: 'scale(-1 1)' })}
                  />
                </>
              ) : (
                <circle className="ccg-unit-body" cy={-6} r={radius * 0.5} />
              )}
              {dir && !art[u.def] && (
                <path
                  className="ccg-unit-facing"
                  d="M -6 -5 L 6 0 L -6 5 Z"
                  transform={`translate(${dir.x * radius * 0.62} ${dir.y * radius * 0.62 - 6}) rotate(${(Math.atan2(dir.y, dir.x) * 180) / Math.PI})`}
                />
              )}
              {!art[u.def] && <text className="ccg-unit-name" y={-6} textAnchor="middle" dy="0.35em">{initials(name(u.def))}</text>}
              <g transform={`translate(${-radius * 0.7} ${radius * 0.5})`}>
                <rect className="ccg-hp-track" width={radius * 1.4} height={12} rx={6} />
                <rect className="ccg-hp-fill" width={Math.max(0, (radius * 1.4 * Math.max(0, u.hp)) / Math.max(1, u.maxHp))} height={12} rx={6} />
                <text className="ccg-hp-text" x={radius * 0.7} y={6} dy="0.35em" textAnchor="middle">{Math.max(0, u.hp)}/{u.maxHp}</text>
              </g>
              {u.block > 0 && (
                <g className="ccg-block" transform={`translate(${-radius * 0.55} ${-radius * 0.55})`}>
                  <path d="M0 -9 L8 -6 L8 1 Q8 7 0 10 Q-8 7 -8 1 L-8 -6 Z" />
                  <text textAnchor="middle" dy="0.35em">{u.block}</text>
                </g>
              )}
              {Object.keys(u.statuses).length > 0 && (
                <text className="ccg-statuses" x={radius * 0.55} y={-radius * 0.55} textAnchor="end">
                  {Object.entries(u.statuses).map(([s, n]) => `${initials(name(s))}${n}`).join(' ')}
                </text>
              )}
              {markers
                .filter((m) => m.host === u.id)
                .map((m, i) => (
                  <g key={m.id} className="ccg-attachment" transform={`translate(${-radius * 0.98} ${radius * 0.12 - i * 15})`} data-permanent={m.id} aria-label={`${m.label} attached`} role="img">
                    <rect x={-2} y={-8} width={Math.max(26, m.label.length * 6)} height={14} rx={7} />
                    <text x={4} dy="0.3em">{initials(m.label)}</text>
                  </g>
                ))}
              {intent && (
                <g className={mine ? 'ccg-intent is-ally' : 'ccg-intent'} transform={`translate(0 ${-radius - 6})`}>
                  <rect x={-30} y={-11} width={60} height={20} rx={10} />
                  <text textAnchor="middle" dy="0.35em">
                    {summary?.damage !== undefined ? `⚔ ${summary.damage}` : (intent.name ?? '?')}
                  </text>
                </g>
              )}
              <title>{label}</title>
            </g>
          );
        })}
      </g>

      <g>
        {targets.map((t, i) => {
          const p = at.get(t.cell);
          if (!p) return null;
          return (
            <g
              key={`${t.cell}:${i}`}
              className={['ccg-target', t.onUnit ? 'on-unit' : 'on-tile', t.focused && 'is-focused'].filter(Boolean).join(' ')}
              transform={`translate(${p.x} ${p.y})`}
              role="button"
              tabIndex={0}
              aria-label={t.label}
              onClick={(e) => {
                e.stopPropagation();
                t.onPick();
              }}
              onKeyDown={activate(t.onPick)}
            >
              {t.onUnit ? (
                <circle cy={-6} r={radius * 0.68} />
              ) : hex ? (
                <polygon points={hexPoints(radius - 6)} />
              ) : (
                <rect x={-radius + 6} y={-radius + 6} width={radius * 2 - 12} height={radius * 2 - 12} rx={6} />
              )}
              <title>{t.label}</title>
            </g>
          );
        })}
      </g>

      {effect && at.has(units[effect.unit]?.pos ?? '') && (
        <text
          key={`${effect.unit}:${effect.text}`}
          className={`ccg-float tone-${effect.tone}`}
          x={at.get(units[effect.unit]!.pos)!.x}
          y={at.get(units[effect.unit]!.pos)!.y - radius * 0.2}
          textAnchor="middle"
          aria-hidden="true"
        >
          {effect.text}
        </text>
      )}
    </svg>
  );
}

function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.map((w) => w[0]).join('') : name.slice(0, 3)).toUpperCase();
}
