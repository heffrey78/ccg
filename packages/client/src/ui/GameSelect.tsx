import type { GameListing } from '../engine/protocol.js';

export interface GameSelectProps {
  games: GameListing[];
  lastPlayed: string | null;
  onStart(game: string): void;
}

export function GameSelect({ games, lastPlayed, onStart }: GameSelectProps) {
  if (games.length === 0) return <p>No games are installed.</p>;
  return (
    <section aria-labelledby="games-heading">
      <h1 id="games-heading">Choose a game</h1>
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
