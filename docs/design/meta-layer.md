# The meta layer

Requirement #9 · design spike #32 · prototype in `packages/core/src/meta/`

The meta layer sits above encounters: roguelike runs, a persistent collection
with deck rules, and a strategic map that spawns fights. This document is
the spike's outcome: the shape of the layer, a working prototype that proves
the contract, and the tasks that build the rest.

## The contract: launch and result

An encounter knows nothing about campaigns. The meta layer hands it a
**launch** and gets back a **result**:

```ts
interface EncounterLaunch {
  encounter: string;        // qualified encounter id
  seed: string;             // drawn from the campaign's generator
  deck: RunCard[];          // cards, with upgrades
  hp?: Record<string, number>;   // player units' HP going in, by unit definition
  difficulty?: string;
  context?: Record<string, unknown>;  // what launched it, e.g. { region }
}

interface EncounterResult {
  won: boolean;
  hp: Record<string, number>;     // player units' HP at the end
  rounds: number;
}
```

`launchOptions(launch)` turns a launch into the standard game's setup
options, the same ones runs use today, and `encounterResult(ruleset, state)`
reads a result off a finished game. Nothing in the encounter kernel changes.

## The meta kernel

A campaign is a deterministic reducer shaped like the encounter kernel:

```ts
interface MetaState<M> {
  world: M;                 // the module's state: a run's map, a strategic map...
  rng: RngState;            // the campaign's own seeded generator
  step: number;
  pending: EncounterLaunch | null;   // the fight being played
  outcome: { won: boolean; reason: string } | null;
}

interface MetaRules<M, A> {
  legal(state): A[];
  apply(state, action, rng): { events, launch? } | { error };
  resolve(state, launch, result, rng): { events, launch? };
  outcome?(state);
}
```

- `applyMeta(rules, state, action)` checks the action is legal and applies it
  to a copy. While an encounter is pending, it refuses.
- `resolveEncounter(rules, state, result)` feeds the pending fight's result
  back. A result can launch the next fight directly, as a run's elite chain
  might.
- Encounter seeds come from the campaign's generator, so a campaign seed
  fixes every fight.

**Replay.** A campaign log is the start state plus entries. Each entry is a
meta action or a whole encounter's actions, every side's.
`replayCampaign(rules, game, log)` rebuilds the campaign step for step,
hash for hash. Saves follow the same rule: the meta state plus the current
encounter's log. That is today's `SaveGame` (#144), with the meta state in
place of the host's run state.

## Modules

### Runs (reimplements today's run)

Today a run's state (`RunState`) and its rules (`enter`, `onward`,
junctions, springs, fruiting logs) live in the engine host. They become a
meta module, `runModule(ruleset.run)`, with the same content:

- world: the node map, the visited nodes, the deck, HP, connected strains,
  and the current service or reward offer;
- actions: `chooseNode`, `chooseReward`, `chooseService` (the host requests
  that exist now);
- resolve: a won fight offers rewards; a lost one ends the run.

The host then drives any meta module the same way, and Sporeline plays as it
does now. Its runs replay and save through the meta kernel.

### Profile and collection

These persist across campaigns, outside any one campaign's state:

- A **profile**: the cards collected (counts), the unlocks, and the saved
  deck lists. It lives in platform storage and changes only through meta
  events at a campaign's end (rewards, unlocks), so it can be checked.
- **Deck rules**, as content in the ruleset: `decks: { size: { min, max },
  copies: { max, byRarity }, require?: tags, forbid?: tags }`.
  `validateDeck(rules, deck)` returns issues the way content validation
  does.
- A **deck builder** screen in the client, for games with deck rules: the
  collection, the deck, and the rule problems as you build.

### Strategic map (prototype in this spike)

`strategicMap(topology)` is the spike's working module:

- regions on a hex board, each held by the player, the enemy or no one,
  with an income and the encounter that defends it;
- actions: attack a region next to one you hold (launches its encounter),
  recruit a card from the market with gold, end the turn (collect income);
- a won fight takes the region, and HP carries between fights;
- the campaign is won when every region is yours, and lost when your forces
  are spent or the turns run out.

As content, this becomes a `campaign` item: the board (hex radius, or
painted cells), the regions (name, owner, income, encounter, art), the
start (gold, deck), the market and the victory conditions. A first pass
leaves out enemy expansion and diplomacy, as #9 sets out.

## Editor and client

| Module | Editor | Client |
| --- | --- | --- |
| Runs | The ruleset form with its run-map preview (exists) | The run map (exists) |
| Deck rules | A Decks section in the ruleset form | The deck builder, and deck checks before a run |
| Strategic map | A campaign item: a hex painter for regions (like the encounter painter), region fields, the market | A map screen: hex regions by owner, income and gold, and attack, recruit and end turn |

All of it is in the content format, edited without code. Previews reuse the
play client's renderers, as the editor does now.

## What the prototype shows

`packages/core/test/meta.test.ts` plays a small strategic campaign:

1. An attack on a neighbouring region launches its encounter. The launch
   carries the deck, a seed from the campaign's generator, and the region.
2. While the fight is on, the map refuses moves.
3. The encounter plays out in the standard game, and its result takes the
   region and carries HP.
4. Ending the turn collects income from both regions, and recruiting
   spends it on a card.
5. `replayCampaign` rebuilds every step from the log, with identical
   hashes.

## Decisions

Recorded as an ADR (see gh-project):

- The meta layer is a separate deterministic reducer with its own generator.
  It is not part of the encounter's `GameState`, because encounters stay
  ignorant of campaigns and can be played, tested and simulated alone.
- Encounters connect to campaigns only through launch and result.
- Campaign logs (meta actions interleaved with encounter action logs) are
  the replay and save format.
- The profile is separate from campaigns and changes only through campaign
  outcomes.
