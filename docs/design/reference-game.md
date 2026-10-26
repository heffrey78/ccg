# Sporeline: reference game design (#30)

Sporeline is the engine's reference game (requirement #7): a small, original,
turn-based tactical deckbuilder on a lane. It is built in the editor as
`games/reference`, from content only plus any custom ops it has to declare.
Anything the editor or engine can't express gets its own issue (listed at the
end) instead of being worked around in code.

## Pitch

You are a mycelium: a living fungal network creeping along a buried root. Bugs
come to eat you. You grow, rot what blocks you, puff spores, pump water and
turn the bugs against each other. Between fights you spread through a wider
fungal network and **connect with other mycelia**. Each connection grafts a
new strain of mushroom into you, and strains **cross-breed** into hybrid
abilities.

## The board and a turn

- **The strand:** a 9-tile lane, the root your network runs along. East is
  forward, toward the surface.
- **You:** the *Knot*, the fruiting heart of your network (40 HP). You creep
  one tile a turn (the move action), and cards move you further.
- **Sap:** 3 per turn, refilled each turn. Hand of 5, discarded at the end of
  the turn. Block resets each turn.
- **Darkness:** fog of war with sight 3. Bugs beyond sight are unseen, and so
  are their intents. Glowcap structures extend your sight; that is the
  *visions* mechanic.
- **Response windows:** when a bug's attack is announced, you may answer with
  a reaction card.
- **Rounds:** bugs telegraph their intents, you play, then the bugs act. Every
  intent shows its tiles before it lands.
- **Neutral things on the strand:** *stumps* and *dead logs* block the lane
  until rotted away (#104).

## Strains: the card families

The starter deck is 10 cards, from the Knot itself. Every other card belongs to
a strain, and its pool opens when you connect with that strain on the map.

| Strain | Theme | Mechanics |
|---|---|---|
| **Knot** (starter) | your own hyphae | lash, block, creep |
| **Rotcap** | decay | Rot (damage over time), rot stumps, traps |
| **Puffball** | spores | spore clouds (auras), Intoxicated, pushes |
| **Cordyceps** | control | zombify weakened bugs into thralls |
| **Glowcap** | visions | sight structures, peeking, foresight reactions |
| **Rootdrinker** | water | pump water: surges that push, seep that heals, floods |

### Statuses

- **Rot** (intensity): at the start of its phase, the holder takes damage equal
  to its stacks, then loses one stack.
- **Intoxicated** (duration): deals 3 less damage. When applied, the holder's
  intent is delayed a round (`delayIntent`).
- **Soaked** (duration): takes 2 more damage from pushes into things (bump
  damage) and from surges.
- **Thrall**: zombified, fighting for you (#102).

## Cards (34)

Costs are in Sap. "Pos" marks the cards that interact with position or
movement: 14 of 34, over the 1/3 the requirement asks for.

### Knot: the starter deck (10 cards from 5)

| Card | Cost | Targeting | Effect | Pos |
|---|---|---|---|---|
| Hyphal Lash | 1 | enemy within 1 | Deal 6. | |
| Mycelial Mat | 1 | self | Gain 5 block. | |
| Creep | 0 | direction | Step 1. Draw 1. | ✓ |
| Root Shove | 1 | enemy within 1 | Push 2. | ✓ |
| Spore Puff | 1 | enemy within 2 | Apply 2 Rot. | |

The deck is 3 Hyphal Lash, 3 Mycelial Mat, 2 Creep, 1 Root Shove and 1 Spore Puff.

### Rotcap: decay

| Card | Cost | Targeting | Effect | Pos |
|---|---|---|---|---|
| Rot Bloom | 1 | unit within 3 | Apply 4 Rot (stumps and logs too). | |
| Decompose | 2 | unit within 1 | Deal damage equal to twice the target's Rot. | |
| **Rot Pit** (trap) | 1 | empty tile within 3 | Face-down. An enemy entering takes 3 Rot and stops. | ✓ |
| Fruiting Body (structure) | 2 | empty tile within 1 | A 6 HP structure. At the start of your turn it deals 2 to the nearest enemy within 2. | ✓ |
| Feast on Rot | 1 | self | Heal 1 for each Rot stack on enemies. | |

### Puffball: spores

| Card | Cost | Targeting | Effect | Pos |
|---|---|---|---|---|
| **Spore Cloud** (aura) | 1 | tile within 3 | For 2 turns, enemies on or next to it deal 2 less damage. | ✓ |
| Burst | 1 | self | Push every adjacent unit 2. | ✓ |
| Intoxicate | 1 | enemy within 3 | Apply Intoxicated 2. | |
| **Startle Puff** (reaction) | 0 | to an intent at you | Push the attacker 1; it may whiff. | ✓ |
| Drift | 1 | direction | Step 2, apply 1 Rot to anything you pass. | ✓ |

### Cordyceps: control

| Card | Cost | Targeting | Effect | Pos |
|---|---|---|---|---|
| Zombify | 2 | enemy within 1 with HP ≤ 8 | Take control of it: it becomes your thrall (#102, #105). Exhaust. | |
| Puppet Pull | 1 | enemy within 4 | Pull 3. | ✓ |
| Spore Hook | 1 | enemy within 2 | Deal 3. Swap places with it. | ✓ |
| Hivemind | 1 | none | Your thralls get 3 block. Draw 1. | |
| **Lure Spore** (trap) | 1 | empty tile within 3 | Face-down. An enemy entering becomes a thrall if its HP ≤ 10. | ✓ |

### Glowcap: visions

| Card | Cost | Targeting | Effect | Pos |
|---|---|---|---|---|
| **Lantern Cap** (structure) | 1 | empty tile within 2 | A 4 HP structure. You see 3 tiles around it (it is your unit, so it pushes back the fog). | ✓ |
| Glimpse | 0 | none | Peek 3. Draw 1. | |
| **Foresight** (reaction) | 1 | to an intent at you | Gain 6 block. | |
| Phosphor Mark | 1 | enemy within 4 | Reveal its intent fully (#107); it takes 2 more damage this round. | |
| Bioluminescence | 1 | self | Gain 3 block. Draw 2. | |

### Rootdrinker: water

| Card | Cost | Targeting | Effect | Pos |
|---|---|---|---|---|
| Surge | 2 | direction | Push every enemy in a line of 4 by 2, and Soak them. | ✓ |
| Seep | 1 | self | Heal 4. | |
| Waterlogged Hyphae (attachment) | 1 | self | Max HP +6 while attached. | |
| Root Drink | 1 | self | Gain 1 Sap next turn and 3 block. | |
| Flash Flood | 2 | none | Push every enemy 1 east; Soaked ones 2. | ✓ |

### Hybrids: cross-breeds

A hybrid can only be offered once you have cards from both of its parent
strains (#101).

| Hybrid | Parents | Cost | Effect |
|---|---|---|---|
| Necrotic Thrall | Rotcap × Cordyceps | 2 | Zombify an enemy within 1 with HP ≤ 12 that has Rot. |
| Lantern Spores | Glowcap × Puffball | 1 | A spore cloud that also gives you sight around it. |
| Bog Rot | Rootdrinker × Rotcap | 2 | Surge, then 2 Rot to everything pushed. |
| Mind's Eye | Cordyceps × Glowcap | 1 | Peek 2; pull an enemy within 4 by 2. |

That is 30 strain cards plus 4 hybrids. The reactions are Startle Puff and
Foresight; the traps are Rot Pit and Lure Spore; the structures are Fruiting
Body and Lantern Cap; there is one aura and one attachment.

## The bugs

Bugs walk in from the east. An *Intent* is shown above each one;
**partial** means you see only the intent's name, not its target or numbers,
which is the second hidden-information mechanic alongside fog and face-down
traps.

| Bug | HP | Behaviour |
|---|---|---|
| Leafcutter | 8 | Within 1: **Bite** 4. Otherwise **March** (approach 2). |
| Bark Borer | 14 | Within 1: **Gnaw** 6. Otherwise **Tunnel** (approach 1, gain 4 block). |
| Springtail | 6 | **Partial** intents. At random: **Leap** (teleport 3 toward you) or **Nip** 3. |
| Bombardier | 12 | **Reacts to you**: when damaged, it sprays 3 back at whoever hit it (status hook). In turn: Spray 5 at range 2, Scuttle. |
| Grey Slug | 20 | In turn: **Ooze** (gain 6 block), **Devour** 9. |
| Millipede | 16 | In turn: **Curl** (gain 8 block), **Lunge** 7 at range 2. |
| Aphid Herder | 10 | In turn: **Herd** (summons an Aphid, 4 HP, Bite 2), **Bite** 3. |

**Boss: the Weevil Matriarch** (45 HP). Her intents are partial while she is
burrowed. Her pattern, in turn:

1. **Burrow**: gain 10 block, and her next intent is hidden.
2. **Brood**: summon two Larvae (5 HP, Bite 3).
3. **Root Rip**: push you 3 west and deal 6.
4. **Mandible Crush**: deal 14.

At 50% HP she skips Burrow.

## The run: a fungal network

A run is a walk through a **branching network** of nodes (#100). The client
draws it as a fungal map: glowing threads between knots. Each step, you
choose which thread to follow. It runs 7 nodes deep, so a run is about 6
fights.

| Node | What happens |
|---|---|
| **Burrow** (fight) | 1–3 bugs. Win and choose 1 of 3 cards from your connected strains. |
| **Nest** (elite fight) | A tougher mix. Win and choose 1 of 3, or a hybrid you qualify for. |
| **Junction** | Connect with another mycelium: choose 1 of 3 strain cards, and that strain's pool opens. |
| **Spring** | Pump water: heal 30% of max HP, or remove a card from your deck. |
| **Fruiting log** | Cross-breed: take a hybrid you qualify for, or upgrade a card. |
| **The Matriarch's chamber** (boss) | The last node. |

You start with one random strain connected besides the Knot, so even the
first reward is a real choice.

## How it maps to the engine

Most of this is content the editor can already make:
- the ruleset (lane of 9, fog with sight 3, response windows, a move action of 1, undo on);
- cards with effects from the built-in ops (damage, push, pull, step, swap,
  peek, applyStatus, delayIntent, gainControl, spawn, heal, gainBlock, draw);
- traps, structures, the aura and the attachment as permanents;
- statuses with hooks and modifiers;
- enemy behaviour trees.

The engine and editor don't have these yet, so each gets its own issue:

| Gap | Issue |
|---|---|
| A **branching run map** with node types (fight, elite, junction, spring, fruiting, boss) and a map screen in the client, editable in the editor. | #100 |
| **Strain-gated reward pools and hybrid unlocks**: reward pools filtered by the strains you have connected (tags), plus hybrid eligibility. | #101 |
| **Allied units that act**: zombified thralls and summons on your side declare and resolve intents. | #102 |
| **Card removal and upgrades at run nodes** (Spring, Fruiting log). | #103 |
| **Neutral units** (stumps and logs) that don't count for the outcome and can be rotted away. | #104 |
| **Conditions on a target's stats** for card effects, e.g. "HP ≤ 8" for Zombify. | #105 |
| **Sight from structures**: check that fog is lifted around your own structures, as Lantern Cap needs (likely already works). | #106 |
| **Revealing an enemy's intent** (Phosphor Mark). | #107 |

## Before building: a paper playthrough

The test plan asks for three encounters played through before
implementation. With the playtest pane and the balance simulator (#47) in
place, that becomes:
- build the starter deck, the Knot strain, the first two strains and three bugs first;
- play three encounters in the playtest pane, then run 500 greedy-bot simulations of each;
- adjust until a greedy player wins roughly 60–80% of single Burrow fights and
  under 50% of Nests.

## As built (v0.1, #33)

Sporeline lives in `games/reference` as 66 content items: 34 cards, 4 statuses, 7 bugs
plus the boss and the Knot, 9 encounters (one is a practice fight outside the run), the
ruleset with its 13-node network, and 4 scenario tests. It plays in the web client
(Play → Sporeline) and opens in the editor.

Some cards and bugs are simpler than designed, where the engine can't yet express
the design; each gap has an issue:

| Designed | v0.1 | Issue |
|---|---|---|
| Burst, Surge and Flash Flood push several units | They push one target | #117 |
| Feast on Rot heals per Rot stack, Hivemind shields thralls, Root Drink banks Sap | Flat heal and block, draw | — |
| Rot ticks "at the start of its phase" | Once per round, for every holder (stumps too) | — |

**Balance from simulation:**
- **Fights:** a greedy one-move-ahead bot wins every hallway fight, taking about 0–5 damage in Burrows and 5–9 in Nests. The design's 60–80% win target assumed a weaker bot, and blocking against telegraphed intents is exactly what a lookahead bot does well. A random player takes 15–45 damage and loses most Nests.
- **Boss:** a fresh greedy player beats it 88% of the time.
- **Whole runs:** at the content's own numbers (the Easy level), the greedy bot wins about 60% (it was 30–35% before summons replaced the block-and-heal turns). Most losses come at the boss, after carried damage. A full run is completable, and not every run is.

**Difficulty levels (#125):** the first playtest found the run too easy, so
the ruleset now has four levels, set in the editor's Difficulty section. They
scale enemy HP and the damage enemy intents declare (telegraphs show the
scaled number). Whole-run win rates for the greedy bot, from 60 runs each:

| Level | Enemy HP | Enemy damage | Greedy bot wins |
| --- | --- | --- | --- |
| Story | 75% | 75% | 77% |
| Easy | 100% | 100% | 60% |
| Normal (default) | 140% | 150% | 10% |
| Hard | 175% | 200% | 5% |

Since #115, the Aphid Herder's **Herd** summons an Aphid (6 HP, Bite 3) and the
Matriarch's **Brood** summons two Larvae (7 HP, Bite 4) on free tiles beside
them, telegraphed with a dotted outline. They used to gain block and heal, so
the gentler levels got easier while Normal and Hard barely moved.

The scenario tests pin Easy, the numbers they were written for.

The package's tests guard these numbers, and the editor's Balance panel is where
tuning continues.

## Originality

The name, setting, characters, cards and enemies are original. The genre
conventions it draws on (telegraphed intents, a deck that grows from rewards,
a branching map) are shared by the genre, and no existing game's content,
names or layout are reproduced. The lane-and-facing movement nods to games
the owner enjoys without copying any of them.
