/** A card face: the hand's buttons and the editor's preview draw the same thing. */
import type { CardFace } from '../../engine/protocol.js';

export function CardFaceContent({ face, keyHint }: { face: CardFace | undefined; keyHint?: string | undefined }) {
  return (
    <>
      <span className="ccg-card-top">
        <span className="ccg-card-cost">{face ? (Object.values(face.cost)[0] ?? 0) : '?'}</span>
        <span className="ccg-card-name">{face?.name ?? '?'}</span>
      </span>
      {face?.art && <img className="ccg-card-art" src={face.art} alt="" />}
      <span className="ccg-card-text">{face?.text}</span>
      {face && (face.keywords.length > 0 || face.timing !== 'main') && (
        <span className="ccg-card-tags">{[face.timing !== 'main' ? face.timing : null, ...face.keywords].filter(Boolean).join(' · ')}</span>
      )}
      {keyHint && (
        <span className="ccg-card-key" aria-hidden="true">
          {keyHint}
        </span>
      )}
    </>
  );
}

/** A card face on its own, e.g. the editor's live preview. */
export function CardPreview({ face }: { face: CardFace }) {
  return (
    <div className={['ccg-card', 'is-preview', face.timing === 'reaction' && 'is-reaction'].filter(Boolean).join(' ')} data-frame={face.frame} role="img" aria-label={`Card preview: ${face.name}. ${face.targeting} ${face.text}`}>
      <CardFaceContent face={face} />
    </div>
  );
}
