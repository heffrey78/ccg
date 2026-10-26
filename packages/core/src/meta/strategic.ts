/**
 * A strategic map (#9), the spike's prototype meta module: regions on a hex
 * board, each held by the player, the enemy or no one, each with an income
 * and a defending encounter. The player attacks regions next to theirs (a
 * fight), ends turns to collect income, and spends gold on cards.
 */
import type { HexTopology } from '../board/hex.js';
import type { Pos } from '../board/topology.js';
import type { RunCard } from '../standard.js';
import type { MetaRules, MetaState } from './kernel.js';

export interface Region {
  owner: 'player' | 'enemy' | null;
  income: number;
  /** The fight to take it (qualified encounter id). */
  encounter: string;
}

export interface StrategicWorld {
  regions: Record<Pos, Region>;
  gold: number;
  deck: RunCard[];
  hp: Record<string, number>;
  /** Cards for sale and their prices. */
  market: Record<string, number>;
  turn: number;
}

export type StrategicAction = { type: 'attack'; region: Pos } | { type: 'recruit'; card: string } | { type: 'endTurn' };

export function strategicMap(topology: HexTopology, options: { maxTurns?: number } = {}): MetaRules<StrategicWorld, StrategicAction> {
  const owned = (s: MetaState<StrategicWorld>) => Object.entries(s.world.regions).filter(([, r]) => r.owner === 'player');
  return {
    legal(s) {
      const mine = new Set(owned(s).map(([pos]) => pos));
      const targets = Object.entries(s.world.regions)
        .filter(([pos, r]) => r.owner !== 'player' && topology.neighbors(pos).some((n) => mine.has(n)))
        .map(([pos]) => pos)
        .sort((a, b) => topology.compare(a, b));
      const buys = Object.entries(s.world.market)
        .filter(([, price]) => price <= s.world.gold)
        .map(([card]) => card)
        .sort();
      return [...targets.map((region) => ({ type: 'attack' as const, region })), ...buys.map((card) => ({ type: 'recruit' as const, card })), { type: 'endTurn' as const }];
    },
    apply(s, action) {
      const w = s.world;
      switch (action.type) {
        case 'attack': {
          const region = w.regions[action.region] as Region;
          return { events: [{ type: 'Attacked', region: action.region }], launch: { encounter: region.encounter, deck: w.deck, hp: w.hp, context: { region: action.region } } };
        }
        case 'recruit': {
          const price = w.market[action.card] as number;
          w.gold -= price;
          w.deck.push({ def: action.card });
          return { events: [{ type: 'Recruited', card: action.card, price }] };
        }
        case 'endTurn': {
          const income = owned(s).reduce((n, [, r]) => n + r.income, 0);
          w.gold += income;
          w.turn++;
          return { events: [{ type: 'TurnEnded', turn: w.turn, income }] };
        }
      }
    },
    resolve(s, launch, result) {
      const pos = launch.context?.region as Pos;
      const region = s.world.regions[pos] as Region;
      s.world.hp = { ...result.hp };
      if (!result.won) return { events: [{ type: 'AttackRepelled', region: pos }] };
      region.owner = 'player';
      return { events: [{ type: 'RegionTaken', region: pos }] };
    },
    outcome(s) {
      const regions = Object.values(s.world.regions);
      if (regions.every((r) => r.owner === 'player')) return { won: true, reason: 'every region is yours' };
      if (Object.values(s.world.hp).some((hp) => hp <= 0)) return { won: false, reason: 'your forces are spent' };
      if (options.maxTurns !== undefined && s.world.turn >= options.maxTurns) return { won: false, reason: 'time ran out' };
      return null;
    },
  };
}
