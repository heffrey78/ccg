/**
 * A branching run's map (#100), drawn as a network: nodes in columns by
 * depth, threads between them, the path walked so far lit, and the nodes the
 * player can go to next offered as buttons.
 */
import type { KeyboardEvent } from 'react';
import type { RunProgress } from '../../engine/protocol.js';

type MapData = NonNullable<RunProgress['map']>;

const GLYPHS: Record<string, string> = { fight: '⚔', elite: '☠', boss: '♛', junction: '⚭', spring: '≈', fruiting: '❦' };
const KIND_NAMES: Record<string, string> = { fight: 'fight', elite: 'elite fight', boss: 'boss', junction: 'junction', spring: 'spring', fruiting: 'fruiting log' };
const COL = 120;
const ROW = 70;

export function RunMap({ map, onChoose }: { map: MapData; onChoose?(node: string): void }) {
  const columns = new Map<number, MapData['nodes']>();
  for (const n of map.nodes) columns.set(n.depth, [...(columns.get(n.depth) ?? []), n]);
  const tallest = Math.max(...[...columns.values()].map((c) => c.length));
  const at = new Map<string, { x: number; y: number }>();
  for (const [depth, nodes] of columns) {
    nodes.forEach((n, i) => at.set(n.id, { x: 40 + depth * COL, y: 30 + ((tallest - nodes.length) / 2 + i) * ROW }));
  }
  const width = 80 + (Math.max(...columns.keys()) || 0) * COL;
  const height = 60 + (tallest - 1) * ROW;
  const visited = new Set(map.visited);
  const walked = new Set(map.visited.slice(1).map((id, i) => `${map.visited[i]}>${id}`));
  const choices = new Set(map.choices);
  const pick = (id: string) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onChoose?.(id);
    }
  };

  return (
    <svg className="ccg-run-map" viewBox={`0 0 ${width} ${height + 20}`} role="group" aria-label="Run map">
      {map.nodes.flatMap((n) =>
        n.next.map((next) => {
          const a = at.get(n.id);
          const b = at.get(next);
          if (!a || !b) return null;
          const mid = (a.x + b.x) / 2;
          const cls = ['ccg-thread', walked.has(`${n.id}>${next}`) && 'is-walked', n.id === map.current && choices.has(next) && 'is-open'].filter(Boolean).join(' ');
          return <path key={`${n.id}>${next}`} className={cls} d={`M ${a.x} ${a.y} C ${mid} ${a.y}, ${mid} ${b.y}, ${b.x} ${b.y}`} />;
        }),
      )}
      {map.nodes.map((n) => {
        const p = at.get(n.id);
        if (!p) return null;
        const open = choices.has(n.id);
        const cls = ['ccg-node', `is-${n.kind}`, visited.has(n.id) && 'is-visited', n.id === map.current && 'is-current', open && 'is-choice'].filter(Boolean).join(' ');
        const label = `${n.name} (${KIND_NAMES[n.kind] ?? n.kind})`;
        return (
          <g
            key={n.id}
            className={cls}
            transform={`translate(${p.x} ${p.y})`}
            data-node={n.id}
            {...(open && onChoose ? { role: 'button', tabIndex: 0, 'aria-label': `Go to ${label}`, onClick: () => onChoose(n.id), onKeyDown: pick(n.id) } : { 'aria-label': label, role: 'img' })}
          >
            <circle r={16} />
            <text className="ccg-node-glyph" textAnchor="middle" dy="0.35em">
              {GLYPHS[n.kind] ?? '•'}
            </text>
            <text className="ccg-node-name" y={30} textAnchor="middle">
              {n.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
