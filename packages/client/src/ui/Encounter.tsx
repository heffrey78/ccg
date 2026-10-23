/**
 * A plain, fully functional encounter screen: state as text and every legal
 * action as a button. #29 replaces it with board, hand and animation UI; this
 * stays useful as a debug view.
 */
import type { Action, GameEvent } from '@ccg/core';
import type { Snapshot } from '../engine/protocol.js';
import { describeAction } from './describe.js';

interface ViewWorld {
  board?: { units: Record<string, { id: string; def: string; side: string; pos: string; hp: number; maxHp: number; block: number; statuses: Record<string, number> }> };
  cards?: { instances: Record<string, { def: string }>; zones: Record<string, Record<string, string[]>>; resources: Record<string, Record<string, number>> };
  intents?: { declared: { unit: string; name?: string }[] };
}

export interface EncounterProps {
  snapshot: Snapshot;
  log: GameEvent[];
  busy: boolean;
  onAct(action: Action): void;
  onQuit(): void;
}

export function Encounter({ snapshot, log, busy, onAct, onQuit }: EncounterProps) {
  const { view, names, side, legal, deciding } = snapshot;
  const world = view.world as ViewWorld;
  const name = (id: string) => names[id] ?? id;
  const cardDefs = Object.fromEntries(Object.entries(world.cards?.instances ?? {}).map(([id, c]) => [id, c.def]));
  const hand = world.cards?.zones[side]?.hand ?? [];
  const resources = world.cards?.resources[side] ?? {};
  const intents = new Map((world.intents?.declared ?? []).map((i) => [i.unit, i.name ?? '?']));

  return (
    <section aria-labelledby="encounter-heading">
      <header style={{ display: 'flex', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <h1 id="encounter-heading" style={{ margin: 0 }}>{snapshot.game.name}</h1>
        <span>Round {view.turn.round}</span>
        <span>Phase: {view.turn.phase}</span>
        <span role="status">
          {view.outcome
            ? view.outcome.winners.includes(side) ? `You win — ${view.outcome.reason}` : `You lose — ${view.outcome.reason}`
            : deciding === side ? 'Your decision' : 'Waiting…'}
        </span>
        <button type="button" onClick={onQuit}>Quit</button>
      </header>

      <h2>Units</h2>
      <table>
        <thead>
          <tr><th>Unit</th><th>Side</th><th>Tile</th><th>HP</th><th>Block</th><th>Statuses</th><th>Intent</th></tr>
        </thead>
        <tbody>
          {Object.values(world.board?.units ?? {}).map((u) => (
            <tr key={u.id}>
              <td>{name(u.def)}</td>
              <td>{u.side}</td>
              <td>{u.pos}</td>
              <td>{u.hp}/{u.maxHp}</td>
              <td>{u.block}</td>
              <td>{Object.entries(u.statuses).map(([s, n]) => `${name(s)} ${n}`).join(', ')}</td>
              <td>{intents.get(u.id) ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Hand</h2>
      <p>
        {Object.entries(resources).map(([r, n]) => `${r}: ${n}`).join(' · ') || 'No resources'}
      </p>
      <ul>{hand.map((id) => <li key={id}>{name(cardDefs[id] ?? id)}</li>)}</ul>

      <h2>Actions</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {legal.map((action, i) => (
          <button key={i} type="button" disabled={busy} onClick={() => onAct(action)}>
            {describeAction(action, names, cardDefs)}
          </button>
        ))}
      </div>

      <h2>Log</h2>
      <ol aria-live="polite" style={{ maxHeight: 200, overflow: 'auto' }}>
        {log.slice(-15).map((e, i) => <li key={i}>{e.type}{typeof e.unit === 'string' ? ` · ${e.unit}` : ''}</li>)}
      </ol>
    </section>
  );
}
