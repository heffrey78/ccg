/**
 * The encounter painter (#45): the game's own board (from its ruleset), where
 * clicks paint tiles and place or remove units. Every click is one undo step.
 */
import { useState } from 'react';
import type { ContentItem } from '@ccg/content';
import { topologyOf, type RulesetDef } from '@ccg/core';
import { projectBoard } from '../../encounters.js';
import { itemsOfKind, type Project } from '../../project.js';
import { useForm } from './SchemaField.js';

interface Placement {
  unit: string;
  side: string;
  pos: string;
  facing?: string;
}

const PREVIEW_BOARDS: Record<string, RulesetDef['board']> = {
  lane: { topology: 'lane', length: 7 },
  square: { topology: 'square', width: 7, height: 7 },
  hex: { topology: 'hex', radius: 3 },
};
const CELL = 44;

const initials = (name: string) => {
  const words = name.split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.map((w) => w[0]).join('') : name.slice(0, 3)).toUpperCase();
};

export function EncounterBoard({ project, item, onChange }: { project: Project; item: ContentItem; onChange(item: ContentItem): void }) {
  const { board: previewKind } = useForm();
  const board = projectBoard(project);
  const topology = board?.topology ?? topologyOf(PREVIEW_BOARDS[previewKind] as RulesetDef['board']);
  const layout = topology.layout?.();
  const ruleset = board ? (project.items[`ruleset:${board.ruleset}`] as unknown as RulesetDef | undefined) : undefined;
  const sides = [ruleset?.player.side ?? 'player', ruleset?.enemy?.side ?? 'enemy'];
  const tileItems = itemsOfKind(project, 'tile');
  const unitItems = itemsOfKind(project, 'unit');

  const [mode, setMode] = useState<'units' | 'tiles'>('units');
  const [brush, setBrush] = useState('');
  const [unit, setUnit] = useState(unitItems.find(([, u]) => u.behavior)?.[1].id ?? unitItems[0]?.[1].id ?? '');
  const [side, setSide] = useState(sides[1] as string);
  const [facing, setFacing] = useState('w');

  const units = (item.units as Placement[] | undefined) ?? [];
  const tiles = (item.tiles as Record<string, string> | undefined) ?? {};
  const name = (kind: 'unit' | 'tile', id: string) => project.items[`${kind}:${id}`]?.name ?? id;

  const click = (pos: string) => {
    if (mode === 'tiles') {
      const next = { ...tiles };
      if (brush === '' || next[pos] === brush) delete next[pos];
      else next[pos] = brush;
      const { tiles: _old, ...rest } = item;
      onChange((Object.keys(next).length > 0 ? { ...rest, tiles: next } : rest) as ContentItem);
      return;
    }
    const at = units.findIndex((u) => u.pos === pos);
    if (at >= 0) onChange({ ...item, units: units.filter((_, i) => i !== at) } as ContentItem);
    else if (unit) onChange({ ...item, units: [...units, { unit, side, pos, facing }] } as ContentItem);
  };

  if (!layout) return <p className="ccg-muted">This board has no layout to paint on.</p>;
  const hex = layout.cell === 'hex';
  const r = hex ? CELL / Math.sqrt(3) - 1 : CELL / 2 - 1.5;
  const hexPoints = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    return `${(r * Math.cos(a)).toFixed(1)},${(r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
  const xs = layout.cells.map((c) => c.x);
  const ys = layout.cells.map((c) => c.y);
  const view = `${(Math.min(...xs) - 0.6) * CELL} ${(Math.min(...ys) - 0.6) * CELL} ${(Math.max(...xs) - Math.min(...xs) + 1.2) * CELL} ${(Math.max(...ys) - Math.min(...ys) + 1.2) * CELL}`;
  const offBoard = units.filter((u) => !topology.contains(u.pos));
  const dirs = layout.directions;

  return (
    <div className="ccg-encounter-board">
      <div className="ccg-row">
        <span role="radiogroup" aria-label="Paint" className="ccg-board-switch">
          <button type="button" role="radio" aria-checked={mode === 'units'} onClick={() => setMode('units')}>
            Units
          </button>
          <button type="button" role="radio" aria-checked={mode === 'tiles'} onClick={() => setMode('tiles')}>
            Tiles
          </button>
        </span>
        {mode === 'tiles' ? (
          <select aria-label="Tile brush" value={brush} onChange={(e) => setBrush(e.target.value)}>
            <option value="">Open ground (erase)</option>
            {tileItems.map(([key, t]) => (
              <option key={key} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        ) : (
          <>
            <select aria-label="Unit to place" value={unit} onChange={(e) => setUnit(e.target.value)}>
              {unitItems.map(([key, u]) => (
                <option key={key} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            <select aria-label="Side to place" value={side} onChange={(e) => setSide(e.target.value)}>
              {sides.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select aria-label="Facing to place" value={facing} onChange={(e) => setFacing(e.target.value)}>
              {Object.keys(dirs).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
      <svg className="ccg-paint-board" viewBox={view} role="group" aria-label={`Encounter board: click to ${mode === 'tiles' ? 'paint tiles' : 'place or remove units'}`}>
        {layout.cells.map((c) => {
          const tile = tiles[c.pos];
          const placed = units.find((u) => u.pos === c.pos);
          const blocking = tile !== undefined && project.items[`tile:${tile}`]?.blocking === true;
          const label = [`Tile ${c.pos}`, tile && name('tile', tile), placed && `${name('unit', placed.unit)} (${placed.side})`].filter(Boolean).join(', ');
          const dir = placed?.facing ? dirs[placed.facing] : undefined;
          return (
            <g
              key={c.pos}
              transform={`translate(${c.x * CELL} ${c.y * CELL})`}
              role="button"
              tabIndex={0}
              aria-label={label}
              data-pos={c.pos}
              className="ccg-paint-cell-group"
              onClick={() => click(c.pos)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  click(c.pos);
                }
              }}
            >
              {hex ? (
                <polygon points={hexPoints} className={['ccg-paint-cell', tile && 'has-tile', blocking && 'is-blocking'].filter(Boolean).join(' ')} />
              ) : (
                <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={4} className={['ccg-paint-cell', tile && 'has-tile', blocking && 'is-blocking'].filter(Boolean).join(' ')} />
              )}
              {tile && !placed && (
                <text className="ccg-paint-tile" textAnchor="middle" dy="0.35em">
                  {initials(name('tile', tile))}
                </text>
              )}
              {placed && (
                <>
                  <circle r={r * 0.62} className={placed.side === sides[0] ? 'ccg-paint-unit is-player' : 'ccg-paint-unit is-enemy'} />
                  {dir && <path d="M -4 -3 L 4 0 L -4 3 Z" className="ccg-paint-facing" transform={`translate(${dir.x * r * 0.78} ${dir.y * r * 0.78}) rotate(${(Math.atan2(dir.y, dir.x) * 180) / Math.PI})`} />}
                  <text className="ccg-paint-label" textAnchor="middle" dy="0.35em">
                    {initials(name('unit', placed.unit))}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
      {offBoard.length > 0 && (
        <p className="ccg-error">
          Off the board: {offBoard.map((u) => `${name('unit', u.unit)} at ${u.pos}`).join(', ')}. Remove them below, or move encounters from the ruleset.
        </p>
      )}
      {!board && <p className="ccg-muted">Add a ruleset to paint on your game's board; this is a preview board.</p>}
    </div>
  );
}
