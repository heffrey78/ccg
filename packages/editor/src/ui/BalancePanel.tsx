/**
 * The balance dashboard (#47): play an encounter many times with a bot and
 * read the results: how often the player wins, how long games last, which
 * cards get played, damage per resource spent, and which enemies hurt most.
 * With difficulty levels (#125), play one level or compare them all.
 */
import { useState } from 'react';
import { summarize, type Bot, type GameRecord, type SimOptions, type SimSummary } from '@ccg/core';
import { itemsOfKind, type Project } from '../project.js';

export type Simulator = (project: Project, options: SimOptions, onProgress?: (done: number) => void) => Promise<GameRecord[]>;

const pct = (x: number) => `${Math.round(x * 100)}%`;
const num = (x: number) => (Math.abs(x) >= 10 ? x.toFixed(0) : x.toFixed(1));

export function BalancePanel({ project, simulate, onClose }: { project: Project; simulate: Simulator; onClose(): void }) {
  const encounters = itemsOfKind(project, 'encounter');
  const [encounter, setEncounter] = useState(encounters[0]?.[1].id ?? '');
  const [bot, setBot] = useState<Bot>('greedy');
  const levels = (itemsOfKind(project, 'ruleset')[0]?.[1] as { difficulty?: { levels: { id: string; name: string }[] } } | undefined)?.difficulty?.levels ?? [];
  // A level's id, '' for the game's default, or '*' to compare every level.
  const [level, setLevel] = useState('');
  const [games, setGames] = useState(100);
  const [firstSeed, setFirstSeed] = useState(1);
  const [running, setRunning] = useState<{ done: number; started: number } | null>(null);
  const [result, setResult] = useState<{ summary: SimSummary; ms: number; options: string; byLevel?: [string, number][] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = (ref: string) => project.items[`unit:${ref.slice(project.manifest.id.length + 1)}`]?.name ?? project.items[`card:${ref.slice(project.manifest.id.length + 1)}`]?.name ?? ref;

  const run = async () => {
    const started = performance.now();
    setRunning({ done: 0, started });
    setError(null);
    try {
      const seeds = Array.from({ length: games }, (_, i) => firstSeed + i);
      const options = (difficulty?: string): SimOptions => ({ seeds, bot, encounter: `${project.manifest.id}:${encounter}`, ...(difficulty && { difficulty }) });
      const what = `${games} games of ${encounters.find(([, e]) => e.id === encounter)?.[1].name ?? encounter}, ${bot} player, seeds ${firstSeed}–${firstSeed + games - 1}`;
      if (level === '*') {
        // Every level on the same seeds; the dashboard shows the first, the comparison all of them.
        const byLevel: [string, number][] = [];
        let first: SimSummary | null = null;
        for (const [i, l] of levels.entries()) {
          const summary = summarize(await simulate(project, options(l.id), (done) => setRunning({ done: i * games + done, started })));
          first ??= summary;
          byLevel.push([l.name, summary.winRate]);
        }
        if (first) setResult({ summary: first, ms: performance.now() - started, options: `${what}, at each level (dashboard: ${levels[0]?.name ?? ''})`, byLevel });
      } else {
        const records = await simulate(project, options(level || undefined), (done) => setRunning({ done, started }));
        setResult({ summary: summarize(records), ms: performance.now() - started, options: `${what}${level ? `, ${levels.find((l) => l.id === level)?.name ?? level}` : ''}` });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(null);
    }
  };

  const s = result?.summary;
  return (
    <section className="ccg-validation ccg-balance" aria-labelledby="balance-heading">
      <h2 id="balance-heading">
        Balance{' '}
        <button type="button" aria-label="Close balance" onClick={onClose}>
          ×
        </button>
      </h2>
      <div className="ccg-row">
        <label>
          Encounter{' '}
          <select value={encounter} onChange={(e) => setEncounter(e.target.value)}>
            {encounters.map(([key, e]) => (
              <option key={key} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Player{' '}
          <select value={bot} onChange={(e) => setBot(e.target.value as Bot)}>
            <option value="greedy">greedy (one move ahead)</option>
            <option value="random">random</option>
          </select>
        </label>
        {levels.length > 0 && (
          <label>
            Difficulty{' '}
            <select value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="">Default</option>
              {levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
              <option value="*">Compare every level</option>
            </select>
          </label>
        )}
        <label>
          Games <input type="number" aria-label="Games" min={1} max={5000} value={games} onChange={(e) => setGames(Math.max(1, Math.min(5000, Number(e.target.value) || 1)))} />
        </label>
        <label>
          First seed <input type="number" aria-label="First seed" value={firstSeed} onChange={(e) => setFirstSeed(Number(e.target.value) || 0)} />
        </label>
        <button type="button" className="ccg-primary" disabled={running !== null || !encounter} onClick={() => void run()}>
          {running ? `Playing… ${running.done}/${level === '*' ? games * levels.length : games}` : 'Simulate'}
        </button>
      </div>
      {error && <p className="ccg-error">{error}</p>}
      {s && result && (
        <div className="ccg-dashboard" aria-label="Balance results">
          <p className="ccg-muted">
            {result.options}; took {(result.ms / 1000).toFixed(1)} s.
          </p>
          {result.byLevel && <Bars title="Player wins at each difficulty" rows={result.byLevel} format={pct} unit="of games won" />}
          <div className="ccg-tiles">
            <Tile label="Player wins" value={pct(s.winRate)} detail={`${s.wins} won, ${s.losses} lost${s.unfinished ? `, ${s.unfinished} unfinished` : ''}`} />
            <Tile label="Rounds per game" value={num(s.averageRounds)} detail="on average" />
            <Tile label="Damage per resource" value={num(s.damagePerResource)} detail="dealt per point spent" />
            <Tile label="Damage taken" value={num(s.averageTaken)} detail="per game, to HP" />
          </div>
          <div className="ccg-charts">
            <Bars title="Games ending in each round" rows={Object.entries(s.rounds).map(([r, n]) => [`Round ${r}`, n])} format={(n) => `${n}`} unit="games" />
            <Bars title="Card plays per game" rows={s.cardPlays.map(([def, n]) => [name(def), n])} format={num} unit="plays per game" />
            <Bars title="Enemy damage per game" rows={s.enemyLethality.map(([def, n]) => [name(def), n])} format={num} unit="damage per game" empty="No enemy hurt the player." />
          </div>
        </div>
      )}
    </section>
  );
}

function Tile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="ccg-tile" role="group" aria-label={label}>
      <span className="ccg-tile-label">{label}</span>
      <strong className="ccg-tile-value">{value}</strong>
      <span className="ccg-muted">{detail}</span>
    </div>
  );
}

/** A single-series bar list that is also its own table: label, bar, value. */
function Bars({ title, rows, format, unit, empty = 'Nothing to show.' }: { title: string; rows: [string, number][]; format(n: number): string; unit: string; empty?: string }) {
  const max = Math.max(0, ...rows.map(([, n]) => n));
  return (
    <figure className="ccg-bars">
      <figcaption>{title}</figcaption>
      {rows.length === 0 ? (
        <p className="ccg-muted">{empty}</p>
      ) : (
        <table>
          <tbody>
            {rows.map(([label, n]) => (
              <tr key={label} title={`${label}: ${format(n)} ${unit}`}>
                <th scope="row">{label}</th>
                <td className="ccg-bar-cell">
                  <span className="ccg-bar" style={{ width: `${max === 0 ? 0 : (n / max) * 100}%` }} />
                </td>
                <td className="ccg-bar-value">{format(n)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </figure>
  );
}
