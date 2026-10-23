import type { CardFace } from '../../engine/protocol.js';

export interface HandCard {
  id: string;
  /** Undefined when the viewer cannot see the card. */
  face?: CardFace;
  playable: boolean;
}

export interface HandProps {
  cards: HandCard[];
  selected: string | null;
  onSelect(card: string): void;
}

const costText = (cost: Record<string, number>) =>
  Object.entries(cost)
    .map(([r, n]) => `${n} ${r}`)
    .join(', ');

export function Hand({ cards, selected, onSelect }: HandProps) {
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
              className={['ccg-card', card.playable && 'is-playable', selected === card.id && 'is-selected', face?.timing === 'reaction' && 'is-reaction'].filter(Boolean).join(' ')}
              aria-pressed={selected === card.id}
              aria-disabled={!card.playable}
              aria-keyshortcuts={i < 9 ? String(i + 1) : undefined}
              aria-label={face ? `${face.name}${cost ? `, costs ${cost}` : ''}. ${face.targeting} ${face.text}${card.playable ? '' : ' Not playable now.'}` : 'Unknown card'}
              onClick={() => card.playable && onSelect(card.id)}
            >
              <span className="ccg-card-top">
                <span className="ccg-card-cost">{face ? (Object.values(face.cost)[0] ?? 0) : '?'}</span>
                <span className="ccg-card-name">{face?.name ?? '?'}</span>
              </span>
              {face?.art && <img className="ccg-card-art" src={face.art} alt="" />}
              <span className="ccg-card-text">{face?.text}</span>
              {face && (face.keywords.length > 0 || face.timing !== 'main') && (
                <span className="ccg-card-tags">{[face.timing !== 'main' ? face.timing : null, ...face.keywords].filter(Boolean).join(' · ')}</span>
              )}
              {i < 9 && <span className="ccg-card-key" aria-hidden="true">{i + 1}</span>}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
