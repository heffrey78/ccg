/**
 * The card table: a lane drawn as a root winding across the table, with every unit a printed card
 * standing on its stone. Near things are large and far things small, so distance reads as depth; the
 * stones count steps from the player's unit, and the stretch of root a chosen card reaches lights up.
 * Hit points, block, statuses and intents are stamps and tokens on the cards that keep a readable size
 * however far away the card stands. It draws the same props as the tile board.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { BoardProps, BoardTarget } from './Board.js';
import { CARD, lineOrder, tableGeometry } from './tablePath.js';

const activate = (fn: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fn();
  }
};

function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.map((w) => w[0]).join('') : name.slice(0, 3)).toUpperCase();
}

/** A small repeatable scatter, so the same beat spatters the same way each time it is drawn. */
function scatter(seed: number, n: number): { a: number; r: number; k: number }[] {
  let x = (Math.imul(seed + 1, 2654435761) >>> 0) || 1;
  const next = () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296;
  return Array.from({ length: n }, () => ({ a: next() * Math.PI * 2, r: next(), k: next() }));
}

interface Stamp {
  key: string;
  at: number;
  text: string;
  tone: string;
  seed: number | null;
}

interface Stain {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

export function TableBoard(props: BoardProps) {
  const { layout, units, tiles, side, intents, intentSummaries, names, targets, effect, selectable, selected, speed, vision, markers = [], art = {}, cardFrame } = props;
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const name = (id: string) => names[id] ?? id;
  const order = useMemo(() => lineOrder(layout), [layout]);
  // The unit the player acts with: steps are counted from it, and its end of the lane is the near one.
  const actor = Object.values(units)
    .filter((u) => u.side === side)
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || (a.id < b.id ? -1 : 1))[0];
  const flipped = useRef<boolean | null>(null);
  if (flipped.current === null && actor) flipped.current = order.indexOf(actor.pos) > (order.length - 1) / 2;
  const cells = useMemo(() => (flipped.current ? [...order].reverse() : order), [order, flipped.current]);
  const indexOf = new Map(cells.map((pos, i) => [pos, i]));
  const geo = size.w > 0 && size.h > 0 ? tableGeometry(cells.length, size.w, size.h) : null;
  const actorAt = actor ? indexOf.get(actor.pos) : undefined;

  const [peek, setPeek] = useState<string | null>(null);
  const [stains, setStains] = useState<Stain[]>([]);
  useEffect(() => setStains([]), [layout]);

  // The press: a hit jolts the table, buzzes the phone and leaves ink on the root.
  const struck = effect ? units[effect.unit] : undefined;
  const struckAt = struck ? indexOf.get(struck.pos) : undefined;
  const hit = effect?.motion === 'hit' ? (effect.beat ?? 0) : null;
  useEffect(() => {
    if (hit === null || !geo || struckAt === undefined) return;
    const p = geo.spots[struckAt];
    if (!p) return;
    const reach = geo.card.w * p.s;
    setStains((old) => [...old, ...scatter(hit, 7).map((d) => ({ x: p.x + Math.cos(d.a) * d.r * reach * 0.6, y: p.y + Math.sin(d.a) * d.r * reach * 0.2, rx: (2 + d.k * 7) * p.s, ry: (1 + d.k * 3) * p.s }))].slice(-80));
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (speed > 0 && !still) root.current?.animate?.([{ transform: 'none' }, { transform: 'translate(-5px, 3px)' }, { transform: 'translate(4px, -3px)' }, { transform: 'translate(-2px, 1px)' }, { transform: 'none' }], { duration: 260 });
    try {
      navigator.vibrate?.(struck?.side === side ? 35 : 15);
    } catch {
      // A phone that won't buzz just doesn't.
    }
    // One press per beat: the board's other props change as the beat plays.
  }, [hit]);

  // Each beat's stamp outlasts the beat, so a number can be read while the next thing happens.
  const [stamps, setStamps] = useState<Stamp[]>([]);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const beatKey = effect ? `${effect.unit}:${effect.text}:${effect.beat ?? 0}` : null;
  useEffect(() => {
    if (!effect || beatKey === null || struckAt === undefined) return;
    const stamp: Stamp = { key: beatKey, at: struckAt, text: effect.text, tone: effect.tone, seed: effect.motion === 'hit' ? (effect.beat ?? 0) : null };
    setStamps((old) => [...old.filter((s) => s.key !== beatKey), stamp]);
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setStamps((old) => old.filter((s) => s !== stamp));
    }, 950 / Math.max(speed, 0.5));
    timers.current.add(timer);
  }, [beatKey]);

  if (!geo) return <div ref={root} className="ccg-board ccg-table" role="group" aria-label={`${layout.kind} board`} />;

  const seen = vision ? new Set(vision) : null;
  const n = cells.length;
  const scaleAt = (i: number) => ((geo.spots[i]?.s ?? 1) * geo.card.w) / CARD.w;

  // What enemy intents will do: the cells they strike, the cells they mark, and what lands on each of the player's units.
  const threatened = new Set<string>();
  const intended = new Set<string>();
  const incoming = new Map<string, number>();
  for (const i of intents) {
    const damage = intentSummaries[i.id]?.damage;
    if (i.side === side) continue;
    if (!damage) {
      for (const c of i.cells ?? []) intended.add(c);
      continue;
    }
    const cellsHit = new Set(i.cells ?? []);
    if (i.bound === 'tile' && i.target) cellsHit.add(i.target);
    if (i.bound === 'unit' && i.target && units[i.target]) cellsHit.add((units[i.target] as (typeof units)[string]).pos);
    for (const c of cellsHit) threatened.add(c);
    for (const u of Object.values(units)) if (u.side === side && cellsHit.has(u.pos)) incoming.set(u.id, (incoming.get(u.id) ?? 0) + damage);
  }
  const intentByUnit = new Map(intents.map((i) => [i.unit, i]));

  // The stretch of root the chosen card can reach, from the actor to its farthest target.
  const targetAt = targets.flatMap((t) => (indexOf.has(t.cell) ? [indexOf.get(t.cell) as number] : []));
  const reach = targetAt.length > 0 && actorAt !== undefined ? ([Math.min(actorAt, ...targetAt), Math.max(actorAt, ...targetAt)] as const) : null;
  const unitTarget = new Map<string, BoardTarget>();
  for (const t of targets) if (t.onUnit && !unitTarget.has(t.cell)) unitTarget.set(t.cell, t);
  const aimsAtEnemies = [...unitTarget.keys()].some((cell) => Object.values(units).some((u) => u.pos === cell && u.side !== side));

  const attacker = effect?.by && effect.by !== effect.unit && (effect.motion === 'hit' || effect.motion === 'blocked') ? units[effect.by] : undefined;
  const attackerAt = attacker ? indexOf.get(attacker.pos) : undefined;
  const transition = speed > 0 ? `transform ${Math.round(280 / speed)}ms cubic-bezier(.3, 1.3, .5, 1), opacity ${Math.round(300 / speed)}ms` : 'none';
  const rootWidth = geo.card.w * 0.34;

  return (
    <div ref={root} className={`ccg-board ccg-table${geo.portrait ? ' is-upright' : ' is-wide'}`} role="group" aria-label={`${layout.kind} board`} style={{ ['--ccg-speed' as string]: Math.max(speed, 0.01) }}>
      <svg className="ccg-table-ground" width={size.w} height={size.h} role="presentation">
        <path className="ccg-root-bed" d={geo.path(0, n - 1)} strokeWidth={rootWidth * 1.35} />
        <path className="ccg-root" d={geo.path(0, n - 1)} strokeWidth={rootWidth} />
        <path className="ccg-root-thread" d={geo.path(0, n - 1)} />
        {reach && reach[1] > reach[0] && (
          <>
            <path className="ccg-reach" d={geo.path(reach[0], reach[1])} strokeWidth={rootWidth * 0.66} />
            <path className="ccg-reach-dots" d={geo.path(reach[0], reach[1])} />
          </>
        )}
        {stains.map((s, i) => (
          <ellipse key={i} className="ccg-stain" cx={s.x} cy={s.y} rx={s.rx} ry={s.ry} />
        ))}
        {cells.map((pos, i) => {
          const p = geo.spots[i];
          if (!p) return null;
          const k = scaleAt(i);
          const tile = tiles[pos];
          const blocking = tile !== undefined && layout.tiles[tile]?.blocking === true;
          const fogged = seen !== null && !seen.has(pos);
          const occupied = Object.values(units).some((u) => u.pos === pos);
          const within = reach !== null && i >= reach[0] && i <= reach[1];
          const cls = ['ccg-cell', blocking && 'is-blocking', tile && !blocking && 'is-special', threatened.has(pos) && 'is-threatened', !threatened.has(pos) && intended.has(pos) && 'is-intended', fogged && 'is-fogged', within && 'is-within'].filter(Boolean).join(' ');
          return (
            <g key={pos} transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`} data-pos={pos}>
              <ellipse className={cls} rx={48 * k} ry={17 * k} />
              {actorAt !== undefined && i !== actorAt && !occupied && (
                <text className={`ccg-step${within ? ' is-within' : ''}`} y={5 * k} fontSize={Math.max(11, 15 * k)} textAnchor="middle">
                  {Math.abs(i - actorAt)}
                </text>
              )}
              {tile && (
                <text className="ccg-tile-label" y={30 * k} fontSize={Math.max(10, 11 * k)} textAnchor="middle">
                  {name(tile)}
                </text>
              )}
              <title>{[pos, tile && name(tile), fogged && 'out of sight'].filter(Boolean).join(' · ')}</title>
            </g>
          );
        })}
        {markers
          .filter((m) => m.pos !== undefined && indexOf.has(m.pos))
          .map((m) => {
            const i = indexOf.get(m.pos as string) as number;
            const p = geo.spots[i];
            if (!p) return null;
            const k = scaleAt(i);
            return (
              <g key={m.id} className={['ccg-aura', m.mine ? 'is-mine' : 'is-enemy'].join(' ')} transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`} data-permanent={m.id} aria-label={`${m.label} (${m.kind}) on ${m.pos}`} role="img">
                <ellipse rx={58 * k} ry={22 * k} />
                <text y={-24 * k} fontSize={Math.max(10, 11 * k)} textAnchor="middle">
                  {m.label}
                </text>
              </g>
            );
          })}
      </svg>

      {Object.values(units).map((u) => {
        const i = indexOf.get(u.pos);
        const p = i === undefined ? undefined : geo.spots[i];
        if (i === undefined || !p) return null;
        const k = scaleAt(i);
        const mine = u.side === side;
        const neutral = u.side === 'neutral';
        const intent = intentByUnit.get(u.id);
        const summary = intent ? intentSummaries[intent.id] : undefined;
        const target = unitTarget.get(u.pos);
        const front = target !== undefined || peek === u.id || selected === u.id;
        const motion = effect?.motion && effect.unit === u.id ? `is-${effect.motion}` : attacker?.id === u.id ? 'is-lunging' : null;
        const lungeTo = motion === 'is-lunging' && attackerAt !== undefined && struckAt !== undefined ? geo.spots[struckAt] : undefined;
        const steps = actorAt === undefined ? null : Math.abs(i - actorAt);
        const hurts = incoming.get(u.id);
        const net = hurts === undefined ? 0 : Math.max(0, hurts - u.block);
        const dir = layout.directions[u.facing];
        const label = `${name(u.def)}, ${mine ? 'yours' : neutral ? 'neutral' : 'enemy'}, ${u.hp} of ${u.maxHp} HP${u.block ? `, ${u.block} block` : ''}${intent ? `, intends ${intent.name ?? 'something'}` : ''}`;
        const pick = () => {
          props.onUnit(u.id);
          const next = peek === u.id ? null : u.id;
          setPeek(next);
          props.onInspect(next);
        };
        const style: CSSProperties = {
          transform: `translate(${(p.x - CARD.w / 2).toFixed(1)}px, ${(p.y - CARD.h).toFixed(1)}px) scale(${(k * (peek === u.id ? 1.12 : 1)).toFixed(3)})`,
          zIndex: (front ? 300 : 100) - i,
          transition,
          ['--inv' as string]: Math.pow(1 / k, 0.75).toFixed(3),
          // The name is printed on the card, so it shrinks with it, but never below what can be read.
          ['--name' as string]: `${Math.max(12.5, 12.6 / k).toFixed(2)}px`,
        };
        return (
          <div
            key={u.id}
            className={['ccg-unit', mine ? 'is-mine' : neutral ? 'is-neutral' : 'is-enemy', u.passable && 'is-passable', u.dying && 'is-dying', selected === u.id && 'is-selected', target && 'is-target', target?.focused && 'is-aimed', peek === u.id && 'is-peeked'].filter(Boolean).join(' ')}
            style={style}
            role="button"
            tabIndex={selectable.has(u.id) ? 0 : -1}
            aria-label={label}
            data-unit={u.id}
            data-pos={u.pos}
            onClick={pick}
            onFocus={() => props.onInspect(u.id)}
            onKeyDown={activate(pick)}
          >
            <div
              key={motion ? `${u.id}:${effect?.beat ?? 0}` : u.id}
              className={['ccg-card', 'ccg-ucard', motion].filter(Boolean).join(' ')}
              data-frame={cardFrame}
              {...(lungeTo && { style: { ['--lx' as string]: `${(((lungeTo.x - p.x) * 0.55) / k).toFixed(1)}px`, ['--ly' as string]: `${(((lungeTo.y - p.y) * 0.55) / k).toFixed(1)}px` } })}
            >
              <span className="ccg-ucard-name">{name(u.def)}</span>
              <span className="ccg-ucard-art">
                {art[u.def] ? <img className="ccg-unit-sprite" src={art[u.def]} alt="" {...(dir && dir.x < -0.01 && { style: { transform: 'scaleX(-1)' } })} /> : <span className="ccg-unit-name">{initials(name(u.def))}</span>}
              </span>
              <span className="ccg-badge ccg-ucard-hp">{Math.max(0, u.hp)}</span>
              {u.block > 0 && <span className="ccg-badge ccg-ucard-block">{u.block}</span>}
              {Object.keys(u.statuses).length > 0 && (
                <span className="ccg-tokens">
                  {Object.entries(u.statuses).map(([s, count], j) => (
                    <span key={s} className="ccg-token" data-tone={j % 3} title={name(s)}>
                      <b>{count}</b>
                      <small>{name(s).slice(0, 4)}</small>
                    </span>
                  ))}
                </span>
              )}
              {markers
                .filter((m) => m.host === u.id)
                .map((m) => (
                  <span key={m.id} className="ccg-attachment" data-permanent={m.id} aria-label={`${m.label} attached`} role="img">
                    {initials(m.label)}
                  </span>
                ))}
              {target?.forecast ? (
                <span className="ccg-badge ccg-fore">{target.forecast}</span>
              ) : intent ? (
                <span className={['ccg-badge', 'ccg-ucard-intent', mine && 'is-ally', summary?.damage === undefined && 'is-walk'].filter(Boolean).join(' ')}>
                  {intent.name ?? '?'}
                  {summary?.damage !== undefined ? ` ${summary.damage}` : ''}
                </span>
              ) : mine && net > 0 ? (
                <span className="ccg-badge ccg-ucard-intent is-incoming">−{net} next</span>
              ) : null}
              {!mine && steps !== null && <span className={`ccg-badge ccg-away${aimsAtEnemies && !target ? ' is-far' : ''}`}>{steps} away</span>}
            </div>
          </div>
        );
      })}

      {targets.map((t, j) => {
        const i = indexOf.get(t.cell);
        const p = i === undefined ? undefined : geo.spots[i];
        if (i === undefined || !p) return null;
        const k = scaleAt(i);
        const box = t.onUnit ? { left: p.x - (CARD.w * k) / 2, top: p.y - CARD.h * k, width: CARD.w * k, height: CARD.h * k } : { left: p.x - 54 * k, top: p.y - 24 * k, width: 108 * k, height: 48 * k };
        return (
          <button
            key={`${t.cell}:${j}`}
            type="button"
            className={['ccg-target', t.onUnit ? 'on-unit' : 'on-tile', t.focused && 'is-focused'].filter(Boolean).join(' ')}
            style={{ ...box, zIndex: 400 - i }}
            aria-label={t.label}
            title={t.label}
            data-choice={t.choice}
            onClick={(e) => {
              e.stopPropagation();
              t.onPick();
            }}
          />
        );
      })}

      {stamps.map((s) => {
        const p = geo.spots[s.at];
        if (!p) return null;
        return (
          <div key={s.key} className={`ccg-stamp tone-${s.tone}`} style={{ left: p.x, top: p.y - CARD.h * scaleAt(s.at) * 0.55 }} aria-hidden="true">
            <span>{s.text}</span>
            {s.seed !== null && scatter(s.seed, 10).map((d, i) => <i key={i} style={{ ['--dx' as string]: `${(Math.cos(d.a) * (30 + d.r * 60)).toFixed(0)}px`, ['--dy' as string]: `${(Math.sin(d.a) * (20 + d.r * 50) + 30).toFixed(0)}px`, width: 4 + d.k * 8, height: 4 + d.k * 8 }} />)}
          </div>
        );
      })}
    </div>
  );
}
