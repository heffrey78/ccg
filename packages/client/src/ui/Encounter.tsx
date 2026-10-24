/**
 * The encounter screen (#29): the board, the hand, piles and resources, the
 * stack with its response prompt, and event-driven animation. Every control
 * works with the mouse and the keyboard:
 *
 *   1–9 select a hand card · ←/→ cycle targets · Enter confirm · Esc cancel
 *   M select a unit to move · E end turn · P pass · Z undo · S or Space skip animation
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Action, GameEvent } from '@ccg/core';
import type { Snapshot } from '../engine/protocol.js';
import { describeAction, describeEvent, type EventContext } from './describe.js';
import { Board, type BoardEffect, type BoardMarker, type BoardRenderer, type BoardTarget } from './play/Board.js';
import { CardPreview } from './play/CardFace.js';
import { RunMap } from './play/RunMap.js';
import { Hand } from './play/Hand.js';
import { Inspector, Piles, Resources, StackPanel } from './play/Panels.js';
import { Playback, unitsAfter, type PlaybackState } from './play/playback.js';
import { anchorCell, choicesFor, offers, type Selection } from './play/selection.js';
import { layoutOf, permanentOfUnit, type UnitView, type WorldView } from './play/world.js';

export const SPEEDS = [
  { value: 0, label: 'Instant' },
  { value: 1, label: '1×' },
  { value: 2, label: '2×' },
  { value: 4, label: '4×' },
] as const;

export interface EncounterProps {
  snapshot: Snapshot;
  log: GameEvent[];
  busy: boolean;
  /** Animation speed multiplier; 0 shows results at once. */
  speed: number;
  onSpeed(speed: number): void;
  onAct(action: Action): void;
  onQuit(): void;
  onDebug(): void;
  /** Custom board renderers by topology kind (e.g. from a game's companion UI package). */
  renderers?: Record<string, BoardRenderer>;
  /** In a run, after a win: take a reward card, or null to skip. */
  onChooseReward?(card: string | null): void;
  /** Seconds before an unanswered response prompt passes on its own; 0 waits for the player. */
  autoPass?: number;
  onAutoPass?(seconds: number): void;
  /** Takes back the last action, offered when the snapshot allows it. */
  onUndo?(): void;
  /** In a branching run: go to the chosen next node. */
  onChooseNode?(node: string): void;
}

const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
const isControl = (target: EventTarget | null) => target instanceof Element && (target.tagName === 'BUTTON' || target.getAttribute('role') === 'button');

export function Encounter({ snapshot, log, busy, speed, onSpeed, onAct, onQuit, onDebug, renderers, onChooseReward, autoPass = 0, onAutoPass, onUndo, onChooseNode }: EncounterProps) {
  const { view, side, legal, deciding, catalog, run } = snapshot;
  const world = view.world as WorldView;
  const layout = layoutOf(snapshot.presentation);
  const o = useMemo(() => offers(legal), [legal]);

  // ---- playback: animate from the previous snapshot to this one ----
  const previous = useRef<Snapshot | null>(null);
  const [start, setStart] = useState<Snapshot>(snapshot);
  const [play, setPlay] = useState<PlaybackState>({ beats: [], shown: 0, done: true });
  const playback = useMemo(() => new Playback(setPlay), []);
  useEffect(() => () => playback.dispose(), [playback]);
  useLayoutEffect(() => {
    setStart(previous.current ?? snapshot);
    previous.current = snapshot;
    // Speed changes apply from the next action, so only a new snapshot restarts playback.
    playback.play(snapshot.events, speed);
  }, [snapshot, playback]);
  const playing = !play.done;
  const shownView = playing ? start.view : view;
  const shownWorld = shownView.world as WorldView;
  const finalUnits = world.board?.units ?? {};
  const units: Record<string, UnitView> = playing
    ? unitsAfter(shownWorld.board?.units ?? {}, play.beats.slice(0, play.shown).map((b) => b.event), finalUnits)
    : finalUnits;
  const hand = world.cards?.zones[side]?.hand ?? [];

  // ---- names for events: units and cards seen in either view ----
  const eventContext = useMemo<EventContext>(() => {
    const unitDefs: Record<string, string> = {};
    const cardDefs: Record<string, string> = {};
    const intentNames: Record<string, string> = {};
    for (const w of [start.view.world as WorldView, world]) {
      for (const u of Object.values(w.board?.units ?? {})) unitDefs[u.id] = u.def;
      for (const [id, c] of Object.entries(w.cards?.instances ?? {})) cardDefs[id] = c.def;
      for (const i of w.intents?.declared ?? []) if (i.name) intentNames[i.unit] ??= i.name;
    }
    return { side, unitDefs, cardDefs, intentNames, names: catalog.names };
  }, [start, world, side, catalog]);

  // Action labels name units by their definition, with the tile when two share a name.
  const labelNames = useMemo(() => {
    const all = Object.values(world.board?.units ?? {});
    const out = { ...catalog.names };
    for (const u of all) {
      const name = catalog.names[u.def] ?? u.def;
      out[u.id] = all.filter((o) => o.def === u.def).length > 1 ? `${name} at ${u.pos}` : name;
    }
    return out;
  }, [world, catalog]);

  const beat = playing ? play.beats[play.shown - 1] : undefined;
  const effect = beat ? effectOf(beat.event, (id) => catalog.names[id] ?? id) : null;
  const banner = beat && ['ItemAnnounced', 'CardRevealed', 'PermanentRevealed', 'PermanentEntered'].includes(beat.event.type) ? describeEvent(beat.event, eventContext) : null;

  // ---- selection and targeting ----
  const [selection, setSelection] = useState<Selection>(null);
  const [focus, setFocus] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);
  useEffect(() => {
    setSelection(null);
    setFocus(0);
  }, [snapshot]);
  const choices = useMemo(() => choicesFor(selection, o, world, layout, side), [selection, o, world, layout, side]);
  const canAct = !busy && deciding === side && !view.outcome;

  const act = useCallback(
    (action: Action) => {
      if (!canAct) return;
      playback.skip();
      setSelection(null);
      onAct(action);
    },
    [canAct, onAct, playback],
  );

  /** Selects something; a single untargeted choice is played at once. */
  const choose = (next: Selection) => {
    if (!canAct) return;
    // Choosing shows targets on the final board, so finish any animation first.
    playback.skip();
    if (next && selection && JSON.stringify(next) === JSON.stringify(selection)) {
      setSelection(null);
      return;
    }
    const list = choicesFor(next, o, world, layout, side);
    if (list.length === 1 && list[0]?.anchor.kind === 'none') {
      act(list[0].action);
      return;
    }
    setSelection(list.length > 0 ? next : null);
    setFocus(0);
  };

  const targets: BoardTarget[] = choices.flatMap((c, i) => {
    const cell = anchorCell(c.anchor, world.board, layout);
    return cell === null
      ? []
      : [{ cell, label: describeAction(c.action, labelNames, eventContext.cardDefs, layout?.kind), onUnit: c.anchor.kind === 'unit', focused: i === focus, onPick: () => act(c.action) }];
  });

  const onUnit = (unit: string) => {
    if (o.units.has(unit)) choose({ kind: 'unit', unit });
  };

  // ---- responses: a prompt the player answers, optionally on a timer ----
  const prompted = canAct && view.prompt?.side === side && o.pass !== null;
  const [countdown, setCountdown] = useState<number | null>(null);
  useEffect(() => {
    if (!prompted || autoPass <= 0 || playing) {
      setCountdown(null);
      return;
    }
    setCountdown(autoPass);
    const timer = setInterval(() => setCountdown((n) => (n === null ? null : n - 1)), 1000);
    return () => clearInterval(timer);
  }, [prompted, autoPass, playing, snapshot]);
  useEffect(() => {
    if (countdown === 0 && o.pass) act(o.pass);
  }, [countdown, o.pass, act]);

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if ((key === 's' || (key === ' ' && !isControl(e.target))) && playing) {
        e.preventDefault();
        playback.skip();
        return;
      }
      if (/^[1-9]$/.test(key)) {
        const card = hand[Number(key) - 1];
        if (card && o.cards.has(card)) choose({ kind: 'card', card });
      } else if (key === 'escape') {
        setSelection(null);
      } else if ((key === 'arrowright' || key === 'arrowleft') && choices.length > 0) {
        e.preventDefault();
        setFocus((f) => (f + (key === 'arrowright' ? 1 : choices.length - 1)) % choices.length);
      } else if (key === 'enter' && choices[focus] && !isControl(e.target)) {
        e.preventDefault();
        act(choices[focus].action);
      } else if (key === 'm') {
        const units = [...o.units.keys()];
        if (units.length > 0) choose({ kind: 'unit', unit: units[0] as string });
      } else if (key === 'z' && snapshot.canUndo && onUndo && !busy) {
        playback.skip();
        onUndo();
      } else if (key === 'e' && o.endTurn) {
        act(o.endTurn);
      } else if (key === 'p' && o.pass) {
        act(o.pass);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---- what to show ----
  const inspectedId = hovered ?? (selection?.kind === 'unit' ? selection.unit : null);
  const inspected = inspectedId ? units[inspectedId] : undefined;
  const inspectedIntent = inspectedId ? shownWorld.intents?.declared.find((i) => i.unit === inspectedId) : undefined;
  const permanent = inspectedId ? permanentOfUnit(world, inspectedId) : undefined;
  const permanentCard = permanent ? world.cards?.instances[permanent.card]?.def : undefined;
  const abilities =
    permanent && permanent.controller === side && permanentCard
      ? Object.entries(catalog.cards[permanentCard]?.abilities ?? {}).map(([index, name]) => ({
          index: Number(index),
          name,
          usable: canAct && o.abilities.has(`${permanent.id}:${index}`),
        }))
      : [];
  const Renderer = (layout && renderers?.[layout.kind]) ?? Board;
  const cardName = (instance: string) => {
    const def = world.cards?.instances[instance]?.def;
    return def ? (catalog.names[def] ?? def) : 'Face-down card';
  };
  const permanents = Object.values(world.permanents ?? {});
  const markers: BoardMarker[] = permanents.flatMap((p): BoardMarker[] =>
    p.kind === 'aura' && p.pos
      ? [{ id: p.id, label: cardName(p.card), kind: p.kind, pos: p.pos, mine: p.controller === side }]
      : p.kind === 'attachment' && p.unit
        ? [{ id: p.id, label: cardName(p.card), kind: p.kind, host: p.unit, mine: p.controller === side }]
        : [],
  );
  const theirs = Object.entries(world.cards?.zones ?? {}).filter(([s]) => s !== side);
  const status = view.outcome
    ? view.outcome.winners.includes(side)
      ? `You win — ${view.outcome.reason}`
      : `You lose — ${view.outcome.reason}`
    : deciding === side
      ? view.prompt
        ? 'Your response'
        : 'Your decision'
      : 'Waiting…';
  const logLines = log.flatMap((e) => {
    const line = describeEvent(e, eventContext);
    return line ? [line] : [];
  });

  return (
    <section className="ccg-encounter" aria-labelledby="encounter-heading">
      <header className="ccg-topbar">
        <h1 id="encounter-heading">{snapshot.game.name}</h1>
        {run && (
          <span className="ccg-run-progress">
            Encounter {run.stage} of {run.total}
          </span>
        )}
        <span>Round {view.turn.round}</span>
        <span className="ccg-muted">{view.turn.phase}</span>
        <span role="status" className="ccg-turn-status">
          {status}
        </span>
        <span className="ccg-spacer" />
        <label className="ccg-speed">
          Animation{' '}
          <select value={speed} onChange={(e) => onSpeed(Number(e.target.value))}>
            {SPEEDS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {onAutoPass && (
          <label className="ccg-speed">
            Auto-pass{' '}
            <select value={autoPass} onChange={(e) => onAutoPass(Number(e.target.value))}>
              <option value={0}>off</option>
              <option value={5}>5 s</option>
              <option value={10}>10 s</option>
            </select>
          </label>
        )}
        <button type="button" onClick={onDebug}>
          Debug view
        </button>
        <button type="button" onClick={onQuit}>
          Quit
        </button>
      </header>

      <div className="ccg-main">
        <div className="ccg-stage">
          {banner && (
            <p className="ccg-banner" aria-hidden="true">
              {banner}
            </p>
          )}
          {prompted && !playing && (
            <p className="ccg-respond" role="alert">
              {respondText(view, side, eventContext)}
              {countdown !== null && <span className="ccg-countdown"> Passing in {countdown}s…</span>}
            </p>
          )}
          {layout ? (
            <Renderer
              layout={layout}
              units={units}
              tiles={shownWorld.board?.tiles ?? {}}
              side={side}
              intents={shownWorld.intents?.declared ?? []}
              intentSummaries={playing ? start.intents : snapshot.intents}
              names={catalog.names}
              targets={playing ? [] : targets}
              effect={effect}
              selectable={new Set(canAct ? o.units.keys() : [])}
              selected={selection?.kind === 'unit' ? selection.unit : null}
              onUnit={onUnit}
              onInspect={setHovered}
              speed={speed}
              vision={shownWorld.board?.vision}
              markers={markers}
            />
          ) : (
            <p className="ccg-muted">This game has no board layout; use the debug view.</p>
          )}
          {playing && (
            <button type="button" className="ccg-skip" aria-keyshortcuts="S" onClick={() => playback.skip()}>
              Skip animation
            </button>
          )}
        </div>

        <aside className="ccg-side">
          <StackPanel view={view} side={side} catalog={catalog} pass={canAct ? o.pass : null} onAct={act} />
          {permanents.length > 0 && (
            <section className="ccg-permanents" aria-label="Permanents">
              <h2>Permanents</h2>
              <ul>
                {permanents.map((p) => {
                  const def = world.cards?.instances[p.card]?.def;
                  const abilities = def ? Object.entries(catalog.cards[def]?.abilities ?? {}) : [];
                  return (
                    <li key={p.id}>
                      <strong>{cardName(p.card)}</strong> <span className="ccg-muted">{p.kind}{p.controller === side ? '' : ' · enemy'}{p.turnsLeft !== undefined ? ` · ${p.turnsLeft} turns left` : ''}</span>
                      {p.controller === side &&
                        abilities.map(([index, name]) => (
                          <button key={index} type="button" disabled={!canAct || !o.abilities.has(`${p.id}:${index}`)} onClick={() => choose({ kind: 'ability', permanent: p.id, ability: Number(index) })}>
                            {name}
                          </button>
                        ))}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          <Inspector
            unit={inspected}
            intent={inspectedIntent}
            summary={inspectedIntent ? (playing ? start.intents : snapshot.intents)[inspectedIntent.id] : undefined}
            permanent={permanent}
            catalog={catalog}
            world={world}
            abilities={abilities}
            onAbility={(ability) => permanent && choose({ kind: 'ability', permanent: permanent.id, ability })}
          />
          <section aria-label="Log" className="ccg-log">
            <h2>Log</h2>
            <ol aria-live="polite">
              {logLines.slice(-10).map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ol>
          </section>
        </aside>
      </div>

      <div className="ccg-tray">
        <div className="ccg-tray-info">
          <Resources world={world} side={side} />
          <Piles world={world} side={side} catalog={catalog} />
          {theirs.map(([other, zones]) =>
            Object.values(zones).some((z) => z.length > 0) ? (
              <span key={other} className="ccg-muted" aria-label={`${other} cards`}>
                {other}: {zones.hand?.length ?? 0} in hand, {zones.draw?.length ?? 0} in deck
              </span>
            ) : null,
          )}
        </div>
        <Hand
          cards={hand.map((id) => {
            const def = world.cards?.instances[id]?.def;
            const face = def ? catalog.cards[def] : undefined;
            return { id, ...(face && { face }), playable: canAct && o.cards.has(id) };
          })}
          selected={selection?.kind === 'card' ? selection.card : null}
          onSelect={(card) => choose({ kind: 'card', card })}
          responding={prompted}
        />
        <div className="ccg-actions">
          {selection && (
            <div className="ccg-choices" role="group" aria-label="Choose a target">
              {choices.map((c, i) => (
                <button key={i} type="button" className={i === focus ? 'is-focused' : undefined} onClick={() => act(c.action)}>
                  {describeAction(c.action, labelNames, eventContext.cardDefs, layout?.kind)}
                </button>
              ))}
              <button type="button" onClick={() => setSelection(null)}>
                Cancel
              </button>
            </div>
          )}
          {canAct &&
            o.other.map((a, i) => (
              <button key={i} type="button" onClick={() => act(a)}>
                {describeAction(a, labelNames, eventContext.cardDefs, layout?.kind)}
              </button>
            ))}
          {onUndo && snapshot.canUndo && (
            <button type="button" disabled={busy} aria-keyshortcuts="Z" onClick={onUndo}>
              Undo
            </button>
          )}
          {o.endTurn && (
            <button type="button" className="ccg-primary" disabled={!canAct} aria-keyshortcuts="E" onClick={() => o.endTurn && act(o.endTurn)}>
              End turn
            </button>
          )}
        </div>
      </div>

      {view.outcome && !playing && (
        <div className="ccg-outcome" role="dialog" aria-labelledby="outcome-heading">
          {run?.status === 'map' && run.map ? (
            <>
              <h2 id="outcome-heading">Choose your path</h2>
              {snapshot.notice && <p>{snapshot.notice}</p>}
              <RunMap map={run.map} {...(onChooseNode && { onChoose: onChooseNode })} />
            </>
          ) : run?.status === 'reward' ? (
            <>
              <h2 id="outcome-heading">Victory</h2>
              <p>Choose a card to add to your deck.</p>
              {run.map && <RunMap map={run.map} />}
              <div className="ccg-rewards">
                {(run.rewards ?? []).map((card) => {
                  const face = catalog.cards[card];
                  return (
                    <button key={card} type="button" className="ccg-reward" aria-label={`Take ${face?.name ?? card}`} disabled={busy} onClick={() => onChooseReward?.(card)}>
                      {face ? <CardPreview face={face} /> : card}
                    </button>
                  );
                })}
              </div>
              <button type="button" disabled={busy} onClick={() => onChooseReward?.(null)}>
                Skip
              </button>
            </>
          ) : (
            <>
              <h2 id="outcome-heading">
                {run?.status === 'won' ? 'Run complete' : run?.status === 'lost' ? 'Run over' : view.outcome.winners.includes(side) ? 'Victory' : 'Defeat'}
              </h2>
              <p>
                {view.outcome.reason}
                {run && ` · encounter ${run.stage} of ${run.total}`}
              </p>
              <button type="button" onClick={onQuit}>
                Back to games
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function effectOf(e: GameEvent, name: (id: string) => string): BoardEffect | null {
  const unit = typeof e.unit === 'string' ? e.unit : null;
  if (!unit) return null;
  switch (e.type) {
    case 'DamageDealt':
      return { unit, text: `−${String(e.amount)}`, tone: 'damage' };
    case 'AttackBlocked':
      return { unit, text: 'Blocked', tone: 'block' };
    case 'BlockGained':
      return { unit, text: `+${String(e.amount)} block`, tone: 'block' };
    case 'Healed':
      return { unit, text: `+${String(e.amount)}`, tone: 'heal' };
    case 'StatusChanged':
      return { unit, text: `${name(e.status as string)} ${Number(e.delta) > 0 ? '+' : ''}${String(e.delta)}`, tone: 'status' };
    case 'UnitDied':
      return { unit, text: 'Defeated', tone: 'info' };
    case 'UnitCollided':
      return { unit, text: 'Bump!', tone: 'info' };
    default:
      return null;
  }
}

/** What a response prompt is about, e.g. "Foe: Hit targets you. Respond with a reaction, or pass." */
function respondText(view: Snapshot['view'], side: string, ctx: EventContext): string {
  const prompt = view.prompt;
  if (!prompt) return '';
  if (prompt.window === 'phaseEnd') return 'The phase is ending. Respond, or pass.';
  const item = view.stack.find((i) => i.id === prompt.item) ?? view.stack.at(-1);
  if (!item) return 'Respond with a reaction, or pass.';
  const what =
    item.kind === 'hidden'
      ? 'A face-down card is played'
      : item.kind === 'intent' && item.source
        ? `${ctx.names[ctx.unitDefs[item.source] ?? ''] ?? 'An enemy'}: ${ctx.intentNames[item.source] ?? 'an intent'}`
        : item.source && ctx.cardDefs[item.source]
          ? `${item.controller === side ? 'You play' : 'They play'} ${ctx.names[ctx.cardDefs[item.source] as string] ?? 'a card'}`
          : 'Something happens';
  return `${what}. Respond with a reaction, or pass.`;
}
