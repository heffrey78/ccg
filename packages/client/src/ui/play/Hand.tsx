import type { MouseEvent } from 'react';
import type { CardFace } from '../../engine/protocol.js';
import { CardFaceContent } from './CardFace.js';

export interface HandCard {
  id: string;
  /** Undefined when the viewer cannot see the card. */
  face?: CardFace;
  playable: boolean;
}

export interface HandProps {
  cards: HandCard[];
  selected: string | null;
  /** A card was picked: by touch, or by a click or key. Cards that can't be played are picked by touch only, to be read. */
  onSelect(card: string, touch: boolean): void;
  /** A card raised to be read. */
  lifted?: string | null;
  /** A response prompt is open: playable cards are the eligible reactions. */
  responding?: boolean;
}

const costText = (cost: Record<string, number>) =>
  Object.entries(cost)
    .map(([r, n]) => `${n} ${r}`)
    .join(', ');

/** Whether a click came from a finger or a pen: neither can hover, and both cover what they press. */
const byTouch = (e: MouseEvent<HTMLElement>) => {
  const type = (e.nativeEvent as Partial<PointerEvent>).pointerType;
  return type === 'touch' || type === 'pen';
};

export function Hand({ cards, selected, onSelect, lifted = null, responding = false }: HandProps) {
  if (cards.length === 0) return <p className="ccg-muted">Your hand is empty.</p>;
  return (
    <ol className="ccg-hand" aria-label="Hand">
      {cards.map((card, i) => {
        const face = card.face;
        const cost = face ? costText(face.cost) : '';
        return (
          <li key={card.id}>
            <button
              type="button"
              className={['ccg-card', card.playable && 'is-playable', responding && card.playable && 'is-eligible', selected === card.id && 'is-selected', lifted === card.id && 'is-lifted', face?.timing === 'reaction' && 'is-reaction'].filter(Boolean).join(' ')}
              data-frame={face?.frame}
              aria-pressed={selected === card.id}
              aria-disabled={!card.playable}
              aria-keyshortcuts={i < 9 ? String(i + 1) : undefined}
              aria-label={face ? `${face.name}${cost ? `, costs ${cost}` : ''}. ${face.targeting} ${face.text}${card.playable ? '' : ' Not playable now.'}` : 'Unknown card'}
              onClick={(e) => {
                const touch = byTouch(e);
                if (card.playable || touch) onSelect(card.id, touch);
              }}
            >
              <CardFaceContent face={face} keyHint={i < 9 ? String(i + 1) : undefined} />
            </button>
          </li>
        );
      })}
    </ol>
  );
}
