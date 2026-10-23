/**
 * The target/pattern picker (#40): a shape's settings with a live preview on
 * a small lane, square or hex board, straight from the topology's pattern().
 * For `offsets`, clicking cells adds or removes them.
 */
import type { PatternShape, Pos } from '@ccg/core';
import { offsetPath, previewCells, previewSetup, type PreviewBoard } from '../../forms/patterns.js';
import { NumberInput } from './inputs.js';
import { useForm } from './SchemaField.js';

const KINDS = ['self', 'adjacent', 'line', 'cone', 'ring', 'area', 'offsets'] as const;
const BOARDS: PreviewBoard[] = ['lane', 'square', 'hex'];
const CELL = 26;

const blank = (kind: (typeof KINDS)[number]): PatternShape => {
  switch (kind) {
    case 'line':
    case 'cone':
      return { kind, length: 2 };
    case 'ring':
      return { kind, radius: 1 };
    case 'area':
      return { kind, radius: 1 };
    case 'offsets':
      return { kind, offsets: [] };
    default:
      return { kind };
  }
};

export function PatternPicker({ value, onChange, label }: { value: PatternShape; onChange(v: PatternShape): void; label: string }) {
  const { board, setBoard } = useForm();
  const setup = previewSetup(board);
  const layout = setup.topology.layout?.();
  const cells = new Set(previewCells(setup, value));
  const hex = layout?.cell === 'hex';

  const toggle = (cell: Pos) => {
    if (value.kind !== 'offsets' || cell === setup.origin) return;
    const path = offsetPath(setup, cell);
    if (!path) return;
    const existing = value.offsets.findIndex((o) => previewCells(setup, { kind: 'offsets', offsets: [o] })[0] === cell);
    onChange({ kind: 'offsets', offsets: existing >= 0 ? value.offsets.filter((_, i) => i !== existing) : [...value.offsets, path] });
  };

  const xs = layout?.cells.map((c) => c.x) ?? [0];
  const ys = layout?.cells.map((c) => c.y) ?? [0];
  const pad = 0.8;
  const view = `${(Math.min(...xs) - pad) * CELL} ${(Math.min(...ys) - pad) * CELL} ${(Math.max(...xs) - Math.min(...xs) + pad * 2) * CELL} ${(Math.max(...ys) - Math.min(...ys) + pad * 2) * CELL}`;
  const r = hex ? CELL / Math.sqrt(3) - 1 : CELL / 2 - 1;
  const hexPoints = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    return `${(r * Math.cos(a)).toFixed(1)},${(r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');

  return (
    <div className="ccg-pattern">
      <div className="ccg-row">
        <select aria-label={`${label} shape`} value={value.kind} onChange={(e) => onChange(blank(e.target.value as (typeof KINDS)[number]))}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        {(value.kind === 'line' || value.kind === 'cone') && (
          <label>
            Length <NumberInput label={`${label} length`} value={value.length} min={1} integer onCommit={(length) => onChange({ ...value, length })} />
          </label>
        )}
        {(value.kind === 'ring' || value.kind === 'area') && (
          <label>
            Radius <NumberInput label={`${label} radius`} value={value.radius} min={1} integer onCommit={(radius) => onChange({ ...value, radius })} />
          </label>
        )}
        {value.kind === 'area' && (
          <label>
            <input
              type="checkbox"
              checked={value.includeOrigin === true}
              onChange={(e) => {
                const { includeOrigin: _i, ...rest } = value;
                onChange(e.target.checked ? { ...rest, includeOrigin: true } : rest);
              }}
            />{' '}
            Include centre
          </label>
        )}
        <span className="ccg-spacer" />
        <span role="radiogroup" aria-label="Preview board" className="ccg-board-switch">
          {BOARDS.map((b) => (
            <button key={b} type="button" role="radio" aria-checked={board === b} onClick={() => setBoard(b)}>
              {b}
            </button>
          ))}
        </span>
      </div>
      {layout && (
        <svg className="ccg-pattern-board" viewBox={view} role="group" aria-label={`${label} preview, ${cells.size} cells`}>
          {layout.cells.map((c) => {
            const origin = c.pos === setup.origin;
            const on = cells.has(c.pos);
            const cls = ['ccg-pattern-cell', origin && 'is-origin', on && 'is-on'].filter(Boolean).join(' ');
            const props = {
              className: cls,
              'data-pos': c.pos,
              ...(value.kind === 'offsets' && !origin && { onClick: () => toggle(c.pos), style: { cursor: 'pointer' } }),
            };
            return (
              <g key={c.pos} transform={`translate(${c.x * CELL} ${c.y * CELL})`}>
                {hex ? <polygon points={hexPoints} {...props} /> : <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={3} {...props} />}
                {origin && <path d="M -5 -4 L 6 0 L -5 4 Z" className="ccg-pattern-facing" />}
              </g>
            );
          })}
        </svg>
      )}
      <p className="ccg-muted">
        Facing east from the arrow. {value.kind === 'offsets' ? 'Click cells to add or remove them.' : ''}
      </p>
    </div>
  );
}
