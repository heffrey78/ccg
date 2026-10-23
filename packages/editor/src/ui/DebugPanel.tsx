/**
 * The debugger (#46): the playtest's whole history. Step through every
 * action and the events it caused, see the full state or either side's
 * view with what each action changed, follow the stack, rewind and branch,
 * and save what happened as a regression test.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Action, GameEvent, GameState } from '@ccg/core';
import type { DebugInfo, EngineClient, Snapshot } from '@ccg/client/engine';

export interface DebugPanelProps {
  engine: EngineClient;
  /** The playtest's latest snapshot; the debugger follows it. */
  snapshot: Snapshot;
  names: Record<string, string>;
  onSnapshot(snapshot: Snapshot): void;
  /** Saves the actions so far, with what is true now, as a scenario test; absent when the setup can't be saved. */
  onSaveTest?(actions: Action[], state: GameState<unknown>): void;
}

const escape = (part: string) => part.replace(/~/g, '~0').replace(/\//g, '~1');

/** JSON Pointers of every value that differs between two states, plus their parents. */
export function changedPointers(before: unknown, after: unknown, pointer = '', out = new Set<string>()): Set<string> {
  if (before === after) return out;
  const isObj = (v: unknown) => typeof v === 'object' && v !== null;
  if (isObj(before) && isObj(after) && Array.isArray(before) === Array.isArray(after)) {
    const keys = new Set([...Object.keys(before as object), ...Object.keys(after as object)]);
    const size = out.size;
    for (const k of keys) changedPointers((before as Record<string, unknown>)[k], (after as Record<string, unknown>)[k], `${pointer}/${escape(k)}`, out);
    if (out.size > size) out.add(pointer);
    return out;
  }
  if (JSON.stringify(before) !== JSON.stringify(after)) out.add(pointer);
  return out;
}

function describeAction(action: Action, names: Record<string, string>): string {
  const extras = Object.entries(action)
    .filter(([k]) => k !== 'type' && k !== 'side')
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? (names[v] ?? v) : JSON.stringify(v)}`);
  return `${action.type} by ${action.side}${extras.length > 0 ? ` (${extras.join(', ')})` : ''}`;
}

function eventLine(e: GameEvent): string {
  const { type, cause: _cause, ...rest } = e;
  const fields = Object.entries(rest)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
  return `${type}${fields.length > 0 ? ` ${fields.join(' ')}` : ''}`;
}

export function DebugPanel({ engine, snapshot, names, onSnapshot, onSaveTest }: DebugPanelProps) {
  const [info, setInfo] = useState<DebugInfo | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [view, setView] = useState('state');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Follow the game: every new snapshot moves the debugger to the latest step.
  useEffect(() => setAt(null), [snapshot]);
  useEffect(() => {
    let cancelled = false;
    engine.debug(at ?? undefined).then(
      (next) => {
        if (cancelled) return;
        setInfo(next);
        setError(null);
      },
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [engine, snapshot, at]);

  const total = info?.actions.length ?? 0;
  const step = info?.at ?? 0;
  const shown: unknown = !info ? null : view === 'state' ? info.state : info.views[view];
  const changes = useMemo(() => (info && view === 'state' && info.previous ? changedPointers(info.previous, info.state) : new Set<string>()), [info, view]);
  const events = info && step > 0 ? (info.actions[step - 1]?.events ?? []) : [];
  const shownEvents = filter ? events.filter((e) => eventLine(e).toLowerCase().includes(filter.toLowerCase())) : events;
  const go = (n: number) => setAt(Math.max(0, Math.min(total, n)));

  if (error) return <p className="ccg-error">Debugger: {error}</p>;
  if (!info) return <p className="ccg-muted">Loading the debugger…</p>;
  const state = info.state;

  return (
    <section className="ccg-debugger" aria-label="Debugger">
      <div className="ccg-row">
        <strong>
          Step {step} of {total}
        </strong>
        <button type="button" aria-label="First step" disabled={step === 0} onClick={() => go(0)}>
          ⏮
        </button>
        <button type="button" aria-label="Step back" disabled={step === 0} onClick={() => go(step - 1)}>
          ◀
        </button>
        <button type="button" aria-label="Step forward" disabled={step === total} onClick={() => go(step + 1)}>
          ▶
        </button>
        <button type="button" aria-label="Latest step" disabled={step === total} onClick={() => go(total)}>
          ⏭
        </button>
        <button
          type="button"
          disabled={step === total}
          title="Drop the later actions and play on from this step"
          onClick={() => engine.branch(step).then(onSnapshot, (e: Error) => setError(e.message))}
        >
          Branch from here
        </button>
        {onSaveTest && (
          <button type="button" title="Save the actions up to this step, and what is true after them, as a scenario test" onClick={() => onSaveTest(info.actions.slice(0, step).map((a) => a.action), state)}>
            Save as test
          </button>
        )}
        <span className="ccg-spacer" />
        <span role="radiogroup" aria-label="Show" className="ccg-board-switch">
          {['state', ...Object.keys(info.views)].map((v) => (
            <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => setView(v)}>
              {v === 'state' ? 'Full state' : `${v}'s view`}
            </button>
          ))}
        </span>
      </div>

      <div className="ccg-debugger-main">
        <div>
          <ol className="ccg-timeline" aria-label="Timeline" start={0}>
            <li className={step === 0 ? 'is-current' : undefined}>
              <button type="button" onClick={() => go(0)}>
                Start
              </button>
            </li>
            {info.actions.map((a, i) => (
              <li key={i} className={step === i + 1 ? 'is-current' : undefined}>
                <button type="button" onClick={() => go(i + 1)}>
                  {describeAction(a.action, names)}
                </button>{' '}
                <span className="ccg-muted">{a.events.length} events</span>
              </li>
            ))}
          </ol>
          <h3>Events {step > 0 ? `from step ${step}` : ''}</h3>
          <input type="search" aria-label="Filter events" placeholder="Filter events" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <ol className="ccg-events" aria-label="Events">
            {shownEvents.map((e, i) => (
              <li key={i}>
                <code>{eventLine(e)}</code>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h3>Stack</h3>
          {state.stack.length === 0 ? (
            <p className="ccg-muted">Empty{state.prompt ? '' : '; nothing is waiting for a response.'}</p>
          ) : (
            <ol className="ccg-events" aria-label="Stack">
              {[...state.stack].reverse().map((item) => (
                <li key={item.id}>
                  <code>
                    {item.kind} by {item.controller ?? 'rules'}
                    {item.source ? ` from ${names[item.source] ?? item.source}` : ''}: {item.effects.map((e) => e.op).join(', ')}
                    {item.countered ? ' (countered)' : ''}
                  </code>
                </li>
              ))}
            </ol>
          )}
          {state.prompt && (
            <p>
              Waiting on <strong>{state.prompt.side}</strong> to respond ({state.prompt.window})
            </p>
          )}
          <h3>{view === 'state' ? 'Full state' : `${view}'s view`}</h3>
          {view === 'state' && step > 0 && <p className="ccg-muted">{changes.size > 0 ? 'Highlighted: what this step changed.' : 'This step changed nothing.'}</p>}
          <div className="ccg-state" aria-label="State">
            <Tree value={shown} pointer="" name="" changes={changes} depth={0} />
          </div>
        </div>
      </div>
    </section>
  );
}

function Tree({ value, pointer, name, changes, depth }: { value: unknown; pointer: string; name: string; changes: Set<string>; depth: number }): ReactNode {
  const changed = changes.has(pointer);
  const label = name ? <span className="ccg-json-key">{name}</span> : null;
  if (typeof value !== 'object' || value === null) {
    return (
      <div className={changed ? 'ccg-tree-leaf is-changed' : 'ccg-tree-leaf'} data-pointer={pointer}>
        {label}
        {label && ': '}
        <span className={`ccg-json-${typeof value}`}>{JSON.stringify(value)}</span>
      </div>
    );
  }
  const entries = Object.entries(value);
  const summary = Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`;
  return (
    <details className={changed ? 'ccg-tree-node has-changes' : 'ccg-tree-node'} open={depth < 1 || changed} data-pointer={pointer}>
      <summary>
        {label ?? 'state'} <span className="ccg-muted">{summary}</span>
      </summary>
      <div className="ccg-tree-children">
        {entries.map(([k, v]) => (
          <Tree key={k} value={v} pointer={`${pointer}/${escape(k)}`} name={k} changes={changes} depth={depth + 1} />
        ))}
      </div>
    </details>
  );
}
