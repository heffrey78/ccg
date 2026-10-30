import { useState } from 'react';
import type { Action, GameView } from '@ccg/core';
import type { Catalog, IntentSummary } from '../../engine/protocol.js';
import type { ShownUnit } from './playback.js';
import type { IntentView, PermanentView, WorldView } from './world.js';

const PILES = [
  ['draw', 'Draw pile'],
  ['discard', 'Discard'],
  ['exhaust', 'Exhausted'],
] as const;

/** Pile counts; opening one lists its cards (draw pile order stays hidden). */
export function Piles({ world, side, catalog }: { world: WorldView; side: string; catalog: Catalog }) {
  const [open, setOpen] = useState<string | null>(null);
  const cards = world.cards;
  if (!cards) return null;
  const zones = cards.zones[side] ?? {};
  const listed = (zone: string) => {
    const ids = zones[zone] ?? [];
    const known = ids.flatMap((id) => {
      const def = cards.instances[id]?.def;
      return def ? [catalog.cards[def]?.name ?? def] : [];
    });
    return { names: zone === 'draw' ? known.sort() : known, unknown: ids.length - known.length };
  };
  return (
    <div className="ccg-piles">
      {PILES.map(([zone, label]) => {
        const n = zones[zone]?.length ?? 0;
        if (zone === 'exhaust' && n === 0) return null;
        return (
          <button key={zone} type="button" className="ccg-chip" aria-expanded={open === zone} onClick={() => setOpen(open === zone ? null : zone)}>
            {label} <strong>{n}</strong>
          </button>
        );
      })}
      {open && (
        <div className="ccg-pile-list" role="region" aria-label={PILES.find(([z]) => z === open)?.[1]}>
          {(() => {
            const { names, unknown } = listed(open);
            return (
              <>
                {open === 'draw' && <p className="ccg-muted">Shown in name order; the draw order is hidden.</p>}
                {names.length === 0 && unknown === 0 && <p className="ccg-muted">Empty.</p>}
                <ul>{names.map((n, i) => <li key={i}>{n}</li>)}</ul>
                {unknown > 0 && <p className="ccg-muted">{unknown} unknown</p>}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

export function Resources({ world, side }: { world: WorldView; side: string }) {
  const resources = world.cards?.resources[side] ?? {};
  const entries = Object.entries(resources);
  if (entries.length === 0) return null;
  return (
    <div className="ccg-resources" aria-label="Resources">
      {entries.map(([r, n]) => (
        <span key={r} className="ccg-resource">
          <strong>{n}</strong> {r}
        </span>
      ))}
    </div>
  );
}

export interface InspectorProps {
  unit: ShownUnit | undefined;
  intent: IntentView | undefined;
  summary: IntentSummary | undefined;
  permanent: PermanentView | undefined;
  catalog: Catalog;
  world: WorldView;
  /** Ability index → whether it can be activated now. */
  abilities: { index: number; name: string; usable: boolean }[];
  onAbility(index: number): void;
}

/** Details for the unit under the pointer or keyboard focus: statuses, intent, abilities. */
export function Inspector({ unit, intent, summary, permanent, catalog, world, abilities, onAbility }: InspectorProps) {
  if (!unit)
    return (
      <section className="ccg-inspector" aria-label="Unit details">
        <p className="ccg-muted">Hover, tap or focus a unit for details.</p>
      </section>
    );
  const name = (id: string) => catalog.names[id] ?? id;
  const card = permanent ? world.cards?.instances[permanent.card]?.def : undefined;
  return (
    <section className="ccg-inspector" aria-label="Unit details">
      <h3>{name(unit.def)}</h3>
      <p>
        {Math.max(0, unit.hp)}/{unit.maxHp} HP{unit.block > 0 && ` · ${unit.block} block`}
      </p>
      {Object.entries(unit.statuses).length > 0 && (
        <ul className="ccg-status-list">
          {Object.entries(unit.statuses).map(([s, n]) => (
            <li key={s}>
              <strong>
                {name(s)} {n}
              </strong>
              {catalog.statuses[s]?.description && <span> — {catalog.statuses[s]?.description}</span>}
            </li>
          ))}
        </ul>
      )}
      {intent && (
        <p className="ccg-intent-text">
          <strong>Intent: {intent.name ?? 'hidden'}</strong>
          {summary && <span> — {summary.text}</span>}
        </p>
      )}
      {card && catalog.cards[card] && <p className="ccg-muted">{catalog.cards[card]?.text}</p>}
      {abilities.length > 0 && (
        <div className="ccg-abilities">
          {abilities.map((a) => (
            <button key={a.index} type="button" disabled={!a.usable} onClick={() => onAbility(a.index)}>
              {a.name}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/** The stack, top first, and the response prompt when it is the player's priority. */
export function StackPanel({ view, side, catalog, pass, onAct }: { view: GameView<unknown>; side: string; catalog: Catalog; pass: Action | null; onAct(a: Action): void }) {
  const world = view.world as WorldView;
  const label = (item: GameView<unknown>['stack'][number]) => {
    if (item.kind === 'hidden') return `${item.controller === side ? 'Your' : 'Their'} face-down card`;
    const owner = item.controller === side ? 'You' : 'Enemy';
    if (item.source && world.cards?.instances[item.source]) {
      const def = world.cards.instances[item.source]?.def as string;
      return `${owner}: ${catalog.cards[def]?.name ?? def}`;
    }
    if (item.kind === 'intent' && item.source) {
      const unit = world.board?.units[item.source];
      const intent = world.intents?.declared.find((i) => i.unit === item.source);
      return `${unit ? (catalog.names[unit.def] ?? unit.def) : 'Enemy'}: ${intent?.name ?? 'intent'}`;
    }
    return `${owner}: ${item.kind}`;
  };
  const prompt = view.prompt;
  if (view.stack.length === 0 && !prompt) return null;
  return (
    <section className="ccg-stack" aria-label="Stack">
      {prompt && prompt.side === side && (
        <p className="ccg-prompt" role="alert">
          {prompt.window === 'phaseEnd' ? 'The phase is ending. Respond?' : 'Respond with a reaction, or pass.'}
          {pass && (
            <button type="button" aria-keyshortcuts="P" onClick={() => onAct(pass)}>
              Pass
            </button>
          )}
        </p>
      )}
      <ol>
        {[...view.stack].reverse().map((item) => (
          <li key={item.id} className={item.countered ? 'is-countered' : undefined}>
            {label(item)}
            {item.countered && ' (countered)'}
          </li>
        ))}
      </ol>
    </section>
  );
}
