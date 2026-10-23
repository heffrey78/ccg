import type { GameListing } from '../engine/protocol.js';

export interface GameSelectProps {
  games: GameListing[];
  lastPlayed: string | null;
  onStart(game: string): void;
  /** Loads a zipped game package (as the editor exports). */
  onImport?(file: File): void;
}

export function GameSelect({ games, lastPlayed, onStart, onImport }: GameSelectProps) {
  return (
    <section aria-labelledby="games-heading">
      <h1 id="games-heading">Choose a game</h1>
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
      {games.length === 0 && <p>No games are installed.</p>}
      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 12 }}>
        {games.map((game) => (
          <li key={game.id}>
            <button type="button" onClick={() => onStart(game.id)} style={{ width: '100%', textAlign: 'left', padding: 16 }}>
              <strong>{game.name}</strong> <small>v{game.version}</small>
              {game.id === lastPlayed && <small> · last played</small>}
              {game.description && <div>{game.description}</div>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
