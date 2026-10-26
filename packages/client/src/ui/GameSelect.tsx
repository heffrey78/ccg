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
  /** Loads a zipped game package (as the editor exports). */
  onImport?(file: File): void;
  /** Shows the folder installed packages are read from (desktop). */
  onRevealPackages?(): void;
  /** A saved game in progress (#144), offered first. */
  resume?: { title: string; detail: string; savedAt: number };
  onContinue?(): void;
}

export function GameSelect({ games, lastPlayed, difficulties = {}, onDifficulty, onStart, editable = [], onEdit, onImport, onRevealPackages, resume, onContinue }: GameSelectProps) {
  return (
    <section aria-labelledby="games-heading">
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
      {onImport && (
        <label className="ccg-import">
          Load a game from a zip…{' '}
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
      {games.length === 0 && <p>No games are installed.</p>}
      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 12 }}>
        {games.map((game) => {
          const levels = game.difficulties ?? [];
          const chosen = levels.find((l) => l.id === difficulties[game.id]) ?? levels.find((l) => l.id === game.defaultDifficulty) ?? levels[0];
          return (
            <li key={game.id} className="ccg-game">
              <button type="button" onClick={() => onStart(game.id, chosen?.id)} style={{ flex: 1, textAlign: 'left', padding: 16 }}>
                <strong>{game.name}</strong> <small>v{game.version}</small>
                {game.id === lastPlayed && <small> · last played</small>}
                {game.description && <div>{game.description}</div>}
              </button>
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
              {onEdit && editable.includes(game.id) && (
                <button type="button" className="ccg-game-edit" aria-label={`Edit ${game.name}`} title="Open this game in the editor" onClick={() => onEdit(game.id)}>
                  Edit
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
