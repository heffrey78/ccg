/**
 * The hand on the card table: cards fanned at the player's thumb. A card can be tapped, as in the plain
 * hand, or dragged up onto the table: one that needs a target parks beside the table while a line runs
 * from it to the finger, and letting go on a target plays it. It lists the same buttons as the plain hand.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react';
import { CardFaceContent } from './CardFace.js';
import type { HandProps } from './Hand.js';

export interface FanHandProps extends HandProps {
  /** Whether the selected card is aimed at something on the table, so a dragged card parks and a line is drawn. */
  aiming: boolean;
  /** A drag began on a playable card. */
  onGrab(card: string): void;
  /** The finger moved: where it is, and where the parked card's top is, both in window coordinates. */
  onAim(point: { x: number; y: number }, from: { x: number; y: number } | null): void;
  /** The finger let go; `above` says whether it was over the table rather than the hand. */
  onDrop(above: boolean): void;
}

const costText = (cost: Record<string, number>) =>
  Object.entries(cost)
    .map(([r, n]) => `${n} ${r}`)
    .join(', ');

const byTouch = (e: MouseEvent<HTMLElement>) => {
  const type = (e.nativeEvent as Partial<globalThis.PointerEvent>).pointerType;
  return type === 'touch' || type === 'pen';
};

interface Drag {
  id: string;
  pointer: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  moved: boolean;
}

export function FanHand({ cards, selected, onSelect, lifted = null, responding = false, aiming, onGrab, onAim, onDrop }: FanHandProps) {
  const list = useRef<HTMLOListElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragged = useRef(false);
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Upright, the whole card shows; on its side, the hand peeks over the edge of the screen.
  const peeking = box.h > 0 && box.h < 100;
  const cw = peeking ? 100 : Math.max(84, Math.min(118, box.w * 0.29));
  const ch = cw * 1.42;
  const n = cards.length;
  const step = n > 1 ? Math.min(cw * 0.82, (box.w - cw - 12) / (n - 1)) : 0;
  // Peeking cards barely tilt or dip, so each one's top edge stays above the screen's edge.
  const tilt = n > 1 ? Math.min(peeking ? 3.5 : 8, 34 / (n - 1)) : 0;
  // Where a card waits while it is aimed, and where a tapped card rises to: clear of the root.
  const dock = peeking ? { x: box.w - cw * 0.62 - 88, y: box.h - ch - 8 } : { x: box.w / 2, y: -ch * 0.62 };
  const zone = peeking ? -8 : -24;

  const local = (e: { clientX: number; clientY: number }) => {
    const r = list.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };
  const dockPoint = () => {
    const r = list.current?.getBoundingClientRect();
    return { x: (r?.left ?? 0) + dock.x, y: (r?.top ?? 0) + dock.y };
  };

  const down = (e: PointerEvent<HTMLButtonElement>, id: string, playable: boolean) => {
    dragged.current = false;
    if (!playable || e.button > 0) return;
    setDrag({ id, pointer: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Not every pointer can be captured; the drag still follows it over the hand.
    }
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const moved = drag.moved || Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 10;
    if (!moved) return;
    if (!drag.moved) {
      dragged.current = true;
      if (selected !== drag.id) onGrab(drag.id);
    }
    setDrag({ ...drag, x: e.clientX, y: e.clientY, moved });
    const above = local(e).y < zone;
    onAim({ x: e.clientX, y: e.clientY }, aiming && above ? dockPoint() : null);
  };
  const up = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const was = drag;
    setDrag(null);
    if (was.moved) onDrop(local(e).y < zone);
  };

  if (cards.length === 0) return <p className="ccg-muted ccg-fan-empty">Your hand is empty.</p>;
  return (
    <ol ref={list} className={`ccg-hand ccg-fan${peeking ? ' is-peeking' : ''}`} aria-label="Hand" style={{ ['--fan-w' as string]: `${cw}px`, ['--fan-h' as string]: `${ch}px` }}>
      {cards.map((card, i) => {
        const face = card.face;
        const cost = face ? costText(face.cost) : '';
        const offset = i - (n - 1) / 2;
        const held = drag?.moved && drag.id === card.id;
        const raised = !held && (selected === card.id || lifted === card.id);
        let style: CSSProperties;
        if (held && drag) {
          const at = local({ clientX: drag.x, clientY: drag.y });
          const parked = aiming && at.y < zone;
          style = parked ? { transform: `translate(${dock.x - cw / 2}px, ${dock.y}px) scale(1.06)`, zIndex: 60, transition: 'transform .12s ease-out' } : { transform: `translate(${at.x - cw / 2}px, ${at.y - ch * 0.6}px) rotate(${((at.x - box.w / 2) / 16).toFixed(1)}deg) scale(1.08)`, zIndex: 60, transition: 'none' };
        } else if (raised) {
          const x = peeking ? dock.x : Math.max(cw * 0.62, Math.min(box.w - cw * 0.62, box.w / 2 + offset * step));
          style = { transform: `translate(${x - cw / 2}px, ${peeking ? dock.y : -ch * 0.3}px) scale(1.18)`, zIndex: 50 };
        } else {
          style = { transform: `translate(${box.w / 2 + offset * step - cw / 2}px, ${(Math.abs(offset * tilt) ** 2 * (peeking ? 0.04 : 0.1) + (peeking ? 6 : 10)).toFixed(1)}px) rotate(${(offset * tilt).toFixed(1)}deg)`, zIndex: i + 1 };
        }
        return (
          <li key={card.id} style={style}>
            <button
              type="button"
              className={['ccg-card', card.playable && 'is-playable', responding && card.playable && 'is-eligible', selected === card.id && 'is-selected', lifted === card.id && 'is-lifted', held && 'is-held', face?.timing === 'reaction' && 'is-reaction'].filter(Boolean).join(' ')}
              data-frame={face?.frame}
              aria-pressed={selected === card.id}
              aria-disabled={!card.playable}
              aria-keyshortcuts={i < 9 ? String(i + 1) : undefined}
              aria-label={face ? `${face.name}${cost ? `, costs ${cost}` : ''}. ${face.targeting} ${face.text}${card.playable ? '' : ' Not playable now.'}` : 'Unknown card'}
              onPointerDown={(e) => down(e, card.id, card.playable)}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              onClick={(e) => {
                // The click that ends a drag has already been answered by the drop.
                if (dragged.current) {
                  dragged.current = false;
                  return;
                }
                const touch = byTouch(e);
                if (card.playable || touch) onSelect(card.id, touch);
              }}
            >
              <CardFaceContent face={face} />
            </button>
          </li>
        );
      })}
    </ol>
  );
}
