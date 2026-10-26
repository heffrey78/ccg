/**
 * An item's form (#40, #43): its kind's schema split into sections, with a
 * live preview drawn by the play client's own renderer for cards and a chip
 * for statuses. Header fields (name, id, tags) belong to the item panel.
 */
import { useMemo, useState } from 'react';
import { previewIntents } from '../../behavior.js';
import { previewSetup } from '../../forms/patterns.js';
import { createContentSchemas, type ContentItem, type ContentKind, type OpRegistry } from '@ccg/content';
import { Board, CardPreview, RunMap, themeCss, type Layout, type UnitView } from '@ccg/client';
import { LaneTopology, runMapDepths, type RunMap as RunMapData } from '@ccg/core';
import { cardFace, frameFor, resolveTheme } from '@ccg/client/engine';
import { describe, jsonSchemaOf } from '../../forms/schema.js';
import type { PreviewBoard } from '../../forms/patterns.js';
import type { Project } from '../../project.js';
import type { ProjectIssue } from '../../validate.js';
import { AssetPreview, useAssetUrl, useAssetUrls } from '../AssetPanel.js';
import { itemsOfKind } from '../../project.js';
import { EncounterBoard } from './EncounterBoard.js';
import { Form, ObjectFields, type FormContext } from './SchemaField.js';

const HEADER_FIELDS = ['formatVersion', 'kind', 'id', 'name', 'tags', 'extensions'];

/** Sections per kind; fields not listed fall into "More". */
const SECTIONS: Partial<Record<ContentKind, [string, string[]][]>> = {
  card: [
    ['Play', ['cost', 'targeting', 'timing', 'reaction', 'faceDown', 'exhausts']],
    ['Effects', ['effects']],
    ['Card face', ['rarity', 'keywords', 'text', 'art']],
    ['Permanent', ['permanent']],
    ['Upgrade', ['upgrade']],
  ],
  status: [
    ['Rules', ['stacking', 'hooks', 'modifiers']],
    ['Display', ['description', 'icon']],
  ],
  encounter: [
    ['Board', ['tiles']],
    ['Units', ['units']],
    ['Rewards', ['rewards']],
    ['Scene', ['background']],
  ],
  ruleset: [
    ['Board', ['board', 'move', 'collision', 'bumpDamage', 'edge', 'fog']],
    ['Player', ['player']],
    ['Enemy', ['enemy']],
    ['Responses and permanents', ['responses', 'permanents']],
    ['Run', ['run']],
    ['Difficulty', ['difficulty']],
  ],
  scenario: [
    ['Setup', ['encounter', 'seed', 'difficulty']],
    ['Cards', ['hand', 'deck']],
    ['Test', ['expect', 'actions']],
  ],
  unit: [
    ['Stats', ['hp', 'faction']],
    ['Starting statuses', ['statuses']],
    ['Behaviour', ['behavior']],
    ['Display', ['art']],
  ],
};

export interface ItemFormProps {
  project: Project;
  ops: OpRegistry;
  item: ContentItem;
  issues: ProjectIssue[];
  flagged?: string | undefined;
  board: PreviewBoard;
  setBoard(board: PreviewBoard): void;
  onChange(item: ContentItem): void;
}

/** A content reference's display name, from the project (unqualified ids) by trying each kind. */
export function nameIn(project: Project) {
  return (ref: string) => {
    const id = ref.includes(':') && ref.startsWith(`${project.manifest.id}:`) ? ref.slice(project.manifest.id.length + 1) : ref;
    for (const kind of ['status', 'card', 'unit', 'tile', 'encounter'] as const) {
      const item = project.items[`${kind}:${id}`];
      if (item) return item.name;
    }
    return undefined;
  };
}

export function ItemForm({ project, ops, item, issues, flagged, board, setBoard, onChange }: ItemFormProps) {
  const schemas = useMemo(() => createContentSchemas(ops), [ops]);
  const root = jsonSchemaOf(schemas[item.kind]);
  const spec = describe(root, root);
  const ctx: FormContext = useMemo(() => {
    const byPointer = new Map<string, string[]>();
    const warnings = new Map<string, string[]>();
    for (const i of issues) {
      const map = i.severity === 'warning' ? warnings : byPointer;
      map.set(i.pointer, [...(map.get(i.pointer) ?? []), i.message]);
    }
    return { project, ops, kind: item.kind, board, setBoard, issues: byPointer, warnings, flagged };
  }, [project, ops, item.kind, board, setBoard, issues, flagged]);
  if (spec.kind !== 'object') return null;

  const sections = SECTIONS[item.kind];
  const listed = new Set(sections?.flatMap(([, keys]) => keys) ?? []);
  const rest = spec.fields.map((f) => f.key).filter((k) => !listed.has(k) && !HEADER_FIELDS.includes(k));
  const groups: [string, string[]][] = sections ? [...sections, ...(rest.length > 0 ? [['More', rest] as [string, string[]]] : [])] : [['', rest]];
  const value = item as unknown as Record<string, unknown>;
  const change = (v: Record<string, unknown>) => onChange(v as unknown as ContentItem);

  return (
    <Form.Provider value={ctx}>
      <div className="ccg-item-form">
        <div className="ccg-item-sections">
          {groups.map(([title, keys]) =>
            title ? (
              <fieldset key={title} className="ccg-section">
                <legend>{title}</legend>
                {item.kind === 'encounter' && keys[0] === 'tiles' ? (
                  <EncounterBoard project={project} item={item} onChange={onChange} />
                ) : (
                  <ObjectFields fields={spec.fields} root={root} value={value} onChange={change} pointer="" only={keys} />
                )}
              </fieldset>
            ) : (
              <ObjectFields key="all" fields={spec.fields} root={root} value={value} onChange={change} pointer="" only={keys} />
            ),
          )}
        </div>
        {item.kind === 'card' && <CardPreviewPane project={project} ops={ops} item={item} board={board} />}
        {item.kind === 'status' && <StatusPreview project={project} item={item} />}
        {item.kind === 'unit' && <IntentPreview project={project} ops={ops} item={item} board={board} />}
        {item.kind === 'ruleset' && <MapPreview project={project} item={item} />}
        {item.kind === 'theme' && <ThemePreview project={project} ops={ops} item={item} />}
      </div>
    </Form.Provider>
  );
}

function CardPreviewPane({ project, ops, item, board }: { project: Project; ops: OpRegistry; item: ContentItem; board: PreviewBoard }) {
  const art = typeof item.art === 'string' ? item.art : '';
  const artUrl = useAssetUrl(project.assets[art], art);
  let face;
  try {
    face = cardFace(item, ops, { topology: board, name: nameIn(project), art: () => artUrl ?? undefined });
  } catch {
    face = null;
  }
  return (
    <aside className="ccg-preview" aria-label="Preview">
      {face ? (
        <>
          <div className="ccg-app ccg-preview-host">
            <CardPreview face={face} />
          </div>
          <p className="ccg-card-preview" aria-label="Card text">
            {face.text || <span className="ccg-muted">No text yet.</span>}
          </p>
          {face.targeting && <p className="ccg-muted">{face.targeting}</p>}
        </>
      ) : (
        <p className="ccg-muted">Fix the card's problems to see its preview.</p>
      )}
    </aside>
  );
}

/** What the unit telegraphs over three rounds against a target you place on the board (#44). */
function IntentPreview({ project, ops, item, board }: { project: Project; ops: OpRegistry; item: ContentItem; board: PreviewBoard }) {
  const setup = previewSetup(board);
  const [target, setTarget] = useState<{ board: PreviewBoard; pos: string } | null>(null);
  // Default: the target two tiles in front of the unit.
  const fallback = setup.topology.step(setup.topology.step(setup.origin, 'w') ?? setup.origin, 'w') ?? setup.origin;
  const pos = target?.board === board ? target.pos : fallback;
  const preview = useMemo(() => previewIntents(project, ops, `unit:${item.id}`, board, pos, 3), [project, ops, item.id, board, pos]);
  const layout = setup.topology.layout?.();
  if (!item.behavior) return null;
  const first = new Set(preview.rounds[0]?.cells ?? []);
  const CELL = 22;
  const hex = layout?.cell === 'hex';
  const r = hex ? CELL / Math.sqrt(3) - 1 : CELL / 2 - 1;
  const hexPoints = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    return `${(r * Math.cos(a)).toFixed(1)},${(r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
  const xs = layout?.cells.map((c) => c.x) ?? [0];
  const ys = layout?.cells.map((c) => c.y) ?? [0];
  const view = `${(Math.min(...xs) - 0.7) * CELL} ${(Math.min(...ys) - 0.7) * CELL} ${(Math.max(...xs) - Math.min(...xs) + 1.4) * CELL} ${(Math.max(...ys) - Math.min(...ys) + 1.4) * CELL}`;
  return (
    <aside className="ccg-preview" aria-label="Intent preview">
      <strong>Intent preview</strong>
      {layout && (
        <svg className="ccg-pattern-board" viewBox={view} role="group" aria-label="Preview board: click a tile to move the target">
          {layout.cells.map((c) => {
            const cls = ['ccg-pattern-cell', first.has(c.pos) && 'is-on', c.pos === setup.origin && 'is-origin'].filter(Boolean).join(' ');
            const props = { className: cls, onClick: () => c.pos !== setup.origin && setTarget({ board, pos: c.pos }), style: { cursor: 'pointer' }, 'data-pos': c.pos };
            return (
              <g key={c.pos} transform={`translate(${c.x * CELL} ${c.y * CELL})`}>
                {hex ? <polygon points={hexPoints} {...props} /> : <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={3} {...props} />}
                {c.pos === pos && <circle r={r * 0.55} className="ccg-preview-target" />}
              </g>
            );
          })}
        </svg>
      )}
      <ol className="ccg-preview-rounds" aria-label="Intents by round">
        {preview.rounds.map((round) => (
          <li key={round.round}>
            <strong>{round.name}</strong> {round.text && <span className="ccg-muted">{round.text}</span>}
          </li>
        ))}
      </ol>
      {preview.error && <p className="ccg-error">{preview.error}</p>}
      <p className="ccg-muted">The unit is in blue; click a tile to move its target. Red tiles are telegraphed this round.</p>
    </aside>
  );
}

/** A ruleset's run map, drawn as players will see it (#100). */
function MapPreview({ project, item }: { project: Project; item: ContentItem }) {
  const map = (item.run as { map?: RunMapData } | undefined)?.map;
  if (!map || !Array.isArray(map.nodes) || map.nodes.length === 0) return null;
  const depths = runMapDepths(map);
  const nodes = map.nodes.map((n) => ({
    id: n.id,
    kind: n.kind,
    name: (n.encounter && project.items[`encounter:${n.encounter}`]?.name) || n.id,
    depth: depths.get(n.id) ?? 0,
    next: n.next ?? [],
  }));
  return (
    <aside className="ccg-preview ccg-map-preview" aria-label="Map preview">
      <strong>Run map</strong>
      <div className="ccg-app ccg-preview-host">
        <RunMap map={{ nodes, visited: [map.start], current: map.start, choices: [] }} />
      </div>
    </aside>
  );
}

function StatusPreview({ project, item }: { project: Project; item: ContentItem }) {
  const icon = typeof item.icon === 'string' ? item.icon : null;
  return (
    <aside className="ccg-preview" aria-label="Preview">
      <div className="ccg-status-chip">
        {icon && <AssetPreview project={project} path={icon} size={24} />}
        <strong>{item.name}</strong>
        <span className="ccg-muted">{String(item.stacking)}</span>
      </div>
      {typeof item.description === 'string' && <p>{item.description}</p>}
    </aside>
  );
}

/** Every asset path a theme or card names, for preview URLs. */
function assetPaths(...nodes: unknown[]): string[] {
  const out = new Set<string>();
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (typeof n === 'object' && n !== null) {
      for (const [k, v] of Object.entries(n)) {
        if (typeof v === 'string' && ['art', 'background', 'font'].includes(k)) out.add(v);
        else walk(v);
      }
    }
  };
  nodes.forEach(walk);
  return [...out].sort();
}

const SAMPLE_LANE: Layout = { ...new LaneTopology(5).layout(), tiles: {} };
const sampleUnit = (id: string, def: string, side: string, pos: string, hp: number): UnitView => ({ id, def, side, pos, facing: side === 'player' ? 'e' : 'w', hp, maxHp: hp, block: 0, statuses: {} });

/**
 * The theme as it will look in play (#136): the table, a panel, a small board
 * and a sample card in each frame, drawn by the play client with the theme's CSS.
 */
function ThemePreview({ project, ops, item }: { project: Project; ops: OpRegistry; item: ContentItem }) {
  const cards = itemsOfKind(project, 'card').map(([, c]) => c);
  const frames = ((item.frames as { id: string; name?: string }[] | undefined) ?? []).filter((f) => typeof f.id === 'string');
  // A project card for each frame, and one for the plain card, when there is one.
  const samples = [
    ...frames.map((f) => ({ label: f.name ?? f.id, frame: f.id, card: cards.find((c) => frameFor(item, c) === f.id) })),
    ...(item.defaultFrame ? [] : [{ label: 'No frame', frame: undefined, card: cards.find((c) => frameFor(item, c) === undefined) }]),
  ];
  const encounter = itemsOfKind(project, 'encounter')[0]?.[1] as { units?: { unit: string; side: string }[] } | undefined;
  const mine = encounter?.units?.find((u) => u.side === 'player')?.unit;
  const foe = encounter?.units?.find((u) => u.side !== 'player')?.unit;
  const unitArt = [mine, foe].flatMap((u) => (u ? [project.items[`unit:${u}`]?.art] : []));
  const urls = useAssetUrls(project, assetPaths(item, samples.map((s) => s.card?.art), unitArt));
  // A theme mid-edit can be malformed; the preview then shows the default look.
  const css = (() => {
    try {
      return themeCss(resolveTheme(item, (path) => urls[path] ?? ''), '.ccg-theme-sample');
    } catch {
      return '';
    }
  })();
  const name = (ref: string) => project.items[`unit:${ref}`]?.name ?? project.items[`status:${ref}`]?.name ?? project.items[`card:${ref}`]?.name ?? ref;
  const art: Record<string, string> = {};
  for (const u of [mine, foe]) {
    const path = u ? project.items[`unit:${u}`]?.art : undefined;
    if (u && typeof path === 'string' && urls[path]) art[u] = urls[path] as string;
  }
  const units = { a: sampleUnit('a', mine ?? 'hero', 'player', '1', 30), b: sampleUnit('b', foe ?? 'foe', 'enemy', '3', 20) };
  return (
    <aside className="ccg-preview ccg-theme-preview" aria-label="Theme preview">
      <style>{css}</style>
      <div className="ccg-app ccg-theme-page">
        <div className="ccg-theme-sample">
          <h2>{project.manifest.name}</h2>
          <div className="ccg-theme-panel">
            <p>
              Your decision <span className="ccg-muted">· round 2</span>
            </p>
            <button type="button" className="ccg-primary" tabIndex={-1}>
              End turn
            </button>
          </div>
          <Board
            layout={SAMPLE_LANE}
            units={units}
            tiles={{}}
            side="player"
            intents={[]}
            intentSummaries={{}}
            names={{}}
            targets={[]}
            effect={null}
            selectable={new Set()}
            selected={null}
            onUnit={() => undefined}
            onInspect={() => undefined}
            speed={0}
            art={art}
          />
          <div className="ccg-theme-cards">
            {samples.map((s) => {
              let face;
              try {
                face = s.card ? cardFace(s.card, ops, { name, art: (path) => urls[path], ...(s.frame && { frame: () => s.frame }) }) : undefined;
              } catch {
                face = undefined;
              }
              return (
                <figure key={s.label}>
                  {face ? <CardPreview face={face} /> : <div className="ccg-card is-preview" data-frame={s.frame} />}
                  <figcaption className="ccg-muted">{s.label}</figcaption>
                </figure>
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
}
