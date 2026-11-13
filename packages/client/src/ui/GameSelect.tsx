import { useState } from 'react';
import type { GameListing } from '../engine/protocol.js';

export interface GameSelectProps {
  games: GameListing[];
  lastPlayed: string | null;
  /** The difficulty chosen for each game, by game id (#125); a game's default when absent. */
  difficulties?: Record<string, string>;
  onDifficulty?(game: string, level: string): void;
  onStart(game: string, difficulty?: string): void;
  /** Games that can be opened in an editor; each gets an Edit button. */
  editable?: string[] | undefined;
  onEdit?(game: string): void;
  /** Games installed on this device that can be removed again; each gets a Remove button. */
  removable?: string[] | undefined;
  onRemove?(game: string): void;
  /** Loads a zipped game package (as the editor exports). */
  onImport?(file: File): void;
  /** Shows the folder installed packages are read from (desktop). */
  onRevealPackages?(): void;
  /** A saved game in progress (#144), offered first. */
  resume?: { title: string; detail: string; savedAt: number };
  onContinue?(): void;
}

export function GameSelect({ games, lastPlayed, difficulties = {}, onDifficulty, onStart, editable = [], onEdit, removable = [], onRemove, onImport, onRevealPackages, resume, onContinue }: GameSelectProps) {
  // Removing asks once more, in the page: a mistaken tap shouldn't cost a game.
  const [removing, setRemoving] = useState<string | null>(null);
  return (
    <section className="ccg-home" aria-labelledby="games-heading">
      <h1 id="games-heading">Choose a game</h1>
      {resume && onContinue && (
        <div className="ccg-continue" role="group" aria-label="Saved game">
          <button type="button" className="ccg-primary" onClick={onContinue}>
            Continue {resume.title}
          </button>
          <span className="ccg-muted">
            {resume.detail} · saved {new Date(resume.savedAt).toLocaleString()}
          </span>
        </div>
      )}
      {games.length === 0 && <p>No games are installed.</p>}
      <ul className="ccg-games">
        {games.map((game) => {
          const levels = game.difficulties ?? [];
          const chosen = levels.find((l) => l.id === difficulties[game.id]) ?? levels.find((l) => l.id === game.defaultDifficulty) ?? levels[0];
          const canEdit = onEdit && editable.includes(game.id);
          const canRemove = onRemove && removable.includes(game.id);
          return (
            <li key={game.id} className="ccg-game">
              <button type="button" className="ccg-game-play" onClick={() => onStart(game.id, chosen?.id)}>
                <span className="ccg-game-name">
                  <strong>{game.name}</strong> <small>v{game.version}</small>
                  {game.id === lastPlayed && <small> · last played</small>}
                </span>
                {game.description && <span className="ccg-game-about">{game.description}</span>}
                <span className="ccg-game-go" aria-hidden="true">
                  Play
                </span>
              </button>
              {(chosen || canEdit || canRemove) && (
                <div className="ccg-game-foot">
                  {chosen && (
                    <div className="ccg-difficulty">
                      <label>
                        Difficulty{' '}
                        <select value={chosen.id} aria-label={`${game.name} difficulty`} onChange={(e) => onDifficulty?.(game.id, e.target.value)}>
                          {levels.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      {chosen.description && <small className="ccg-muted">{chosen.description}</small>}
                    </div>
                  )}
                  {canRemove &&
                    (removing === game.id ? (
                      <span className="ccg-game-remove" role="group" aria-label={`Remove ${game.name}?`}>
                        <span className="ccg-muted">Remove it from this device?</span>
                        <button type="button" onClick={() => onRemove(game.id)}>
                          Remove
                        </button>
                        <button type="button" onClick={() => setRemoving(null)}>
                          Keep
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="ccg-game-edit" aria-label={`Remove ${game.name}`} title="Remove this installed game from this device" onClick={() => setRemoving(game.id)}>
                        Remove
                      </button>
                    ))}
                  {canEdit && (
                    <button type="button" className="ccg-game-edit" aria-label={`Edit ${game.name}`} title="Open this game in the editor" onClick={() => onEdit(game.id)}>
                      Edit
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {(onImport || onRevealPackages) && (
        <div className="ccg-home-tools">
          {onImport && (
            <label className="ccg-import">
              Load a game from a zip…
              <input
                type="file"
                accept=".zip,application/zip"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) onImport(file);
                }}
              />
            </label>
          )}
          {onRevealPackages && (
            <button type="button" className="ccg-reveal-packages" onClick={onRevealPackages} title="Put a game's folder or exported zip here, then come back to Play">
              Open packages folder
            </button>
          )}
        </div>
      )}
    </section>
  );
}
