# Resolution order

Status: draft for review · Task #17 · Implements part of #1, #48, #49, #50 ·
Follows decisions #11 and #52

This spec defines how the engine turns an action into state changes: the order
in which effects apply, when triggers fire, when players may respond, when units
die, when permanents enter and leave play, and when hidden information is
revealed. Every rule here must give one unambiguous, deterministic outcome; the
worked examples at the end are the acceptance test for that, and #19 encodes each
one as an integration test.

"Must" is normative. Anything a game package can change is marked
**(configurable)** with its default.

## 1. Vocabulary

| Term | Meaning |
| --- | --- |
| **Side** | A participant with its own zones, resources and controller (human or AI). Turn order is a fixed sequence of sides. The side whose turn it is is the **active side**. |
| **Action** | A top-level request from a controller: play a card, move, activate an ability, respond, pass, end turn. It must appear in `legalActions(state, controller)` or it is rejected with no state change. |
| **Stack item** | Something that resolves as a unit and can be responded to: a played card, an activated ability, an executing enemy intent, or a triggered ability. |
| **Stack** | The LIFO list of stack items waiting to resolve. |
| **Effect** | One primitive op with bound parameters (`damage 3 to unit u7`, `push u7 2 east`). A stack item's effect list expands into effects that run in order. |
| **Step** | The smallest state change. Most effects are one step; multi-step effects (movement, multi-hit) are one step per tile or hit. |
| **Event** | An immutable record of one step's outcome (`UnitEnteredTile`, `DamageDealt`, `CardDrawn`). Events are the only output clients animate from. |
| **Modifier** | A rule that changes a step *before* it applies ("prevent", "instead", "reduce", block). |
| **Interrupt** | A trigger with `timing: "when"`. It fires right after a step and resolves inline, before the current effect continues. |
| **Reactive trigger** | A trigger with `timing: "after"` (the default). It fires after the current stack item finishes resolving, as a new stack item. |
| **Timing point** | A named moment at which a response window may open (§5). |
| **State check** | The routine that applies game-state consequences: deaths, expiries, static recalculation, clamping (§4). |

## 2. The resolution loop

`apply(state, action)` performs these steps. All state is immutable, so if any step fails the
whole action is rejected and the original state is returned unchanged.

1. **Validate** the action against `legalActions`. Reject if absent.
2. **Pay costs** (resources, discards, exhaust). Costs are paid as steps and emit
   events, but cannot be responded to and never trigger interrupts.
   Reactive triggers on cost events (e.g. "after you discard") are collected
   normally.
3. **Announce.** Put the action's stack item on the stack. A card moves from
   its zone to the **resolving** zone (not discard yet) and is revealed per §7.
   Emit `ItemAnnounced`.
4. **Open the response window** for the new top item if the timing point is
   enabled (§5). If anyone may respond, the engine stops here and returns a state
   with a `prompt`; the next action continues from this point.
5. **Resolve the top item** (§3). Then put any collected reactive triggers on the
   stack (§6), and go back to step 4 for the new top item.
6. When the stack is empty and there is no prompt, the action is complete. Phase
   transitions happen only at this point (§8).

The loop never blocks waiting for input. A prompt is ordinary state, and the
controller answers it with another action. That keeps replays as plain
`seed + actions[]`.

## 3. Resolving a stack item

1. Emit `ItemResolving`. If the item was **countered** or **cancelled** while on
   the stack, emit `ItemCountered` instead, move its card to its destination zone,
   and stop. Nothing else about the item happens.
2. **Bind targets.** Targets chosen at announcement are re-checked: a target that
   no longer exists, or is no longer legal, is dropped. Each effect declares
   what happens then via `onInvalidTarget`: `skip` (default), `fizzleItem`,
   or `retarget(rule)`.
3. **Run effects in order.** For each effect:
   1. Evaluate its parameters (§3.1).
   2. For each step:
      1. Apply **modifiers** to the pending step, in modifier order (§6.3).
         A modifier may change the step's numbers or targets, replace it with
         other steps, or prevent it.
      2. Apply the step. Emit its event(s).
      3. Run **interrupts** matching the event (§6.1). Each runs fully,
         including its own state checks, before the effect continues.
      4. Run **state checks** (§4).
      5. If the effect's subject is gone or the step was halted, end the
         effect early.
   3. Run **state checks** again (cheap when nothing changed).
4. Move the card from the resolving zone to its destination: discard (default),
   exhaust, a zone named by the card, or **in play** if the card became a
   permanent (§9). Emit `ItemResolved`.

### 3.1 Parameter evaluation

- Parameters such as `X = cards in hand` are evaluated **when the effect that
  uses them starts**, not when the card was played.
- A card may bind variables at announcement with `bind: "onPlay"`, and later
  effects then see the snapshot. The snapshot is taken after the card has moved
  to the resolving zone and its costs are paid.
- Variables produced by an earlier effect in the same item (e.g.
  `discarded.count`) are available to later effects in that item.

### 3.2 Multi-target effects

An effect with several targets applies its step to each target **in board
order**, then emits the events in that order. Board order is the topology's
canonical position order, with ties broken by entity creation sequence.
Interrupts and state checks run **once after all targets**, not between them, so
"deal 3 to all enemies" is simultaneous: every target is hit before anyone dies.
Movement is the exception. Moving several units is resolved unit by unit, in
board order, because positions depend on each other.

## 4. State checks

State checks run after every step, every interrupt and every effect. They run
in this fixed order, and repeat from the first item until nothing changes:

1. **Recompute statics.** Recompute derived values (max HP, auras, cost
   modifiers) from base values and every active static effect (§9.3).
2. **Clamp.** Clamp current values to their new bounds. If max HP drops,
   current HP becomes `min(current, max)`. **(configurable:** `clamp` | `keepDelta`**)**
3. **Expire.** Remove expired statuses and permanents whose duration ended
   mid-step (most durations end at phase boundaries instead, §8).
4. **Deaths.** Every unit with HP ≤ 0 dies, all at once, in board order.
   Emit `UnitDied` for each one. Then the unit leaves play (§9.4): it is removed
   from the board, and its card or definition goes to its leave-play destination.
5. **Win/lose conditions.** If any side has met a win or lose condition, the game
   ends immediately: the stack and pending triggers are discarded, and the
   engine emits `GameEnded`.

State checks never open response windows and never run reactive triggers. They
only *collect* reactive triggers (e.g. "after this dies").

## 5. Response windows and priority

### 5.1 Timing points

The engine passes these timing points. A window opens at a timing point only if the game
enables it **(configurable, default: none enabled)**. With nothing enabled, the
engine never pauses for responses, and games without reactions play exactly as
if this section didn't exist.

| Timing point | When |
| --- | --- |
| `itemAnnounced` | A new item has just been put on the stack (§2 step 3). |
| `itemTop` | An item becomes the top again after the item above it resolved. |
| `intentDeclared` | An enemy has declared its intents for the round (§10). |
| `phaseEnd` | The stack is empty and the phase is about to end. |

Reactions to things that happen *during* resolution, such as a unit moving or
damage being dealt, are answered at the next window. They cannot be played
between the steps of an effect; only interrupts act there. This is deliberate:
it keeps resolution atomic and lets reactions see the item's full result.

### 5.2 Priority

When a window opens:

1. Priority goes to sides in turn order, **starting with the side after the
   controller of the top item**. In a player-vs-enemies game, the player gets
   the first chance to respond to an enemy intent, and the enemy side gets the
   first chance to respond to a player's card.
2. The side with priority either **responds** (plays a reaction or activates an
   ability whose timing allows this window) or **passes**.
3. A response is announced (§2 step 3), becomes the new top item, and gets its
   own `itemAnnounced` window. Priority restarts per rule 1.
   A reaction's trigger condition ("respond to an attack targeting you") is
   checked against the **current top item** only.
4. When every side passes in succession without a new item, the window closes
   and the top item resolves.
5. **Auto-pass:** a side with no legal response passes immediately, without a
   prompt. An AI side answers through its policy. A prompt is created only when
   the side's controller actually has a choice.
6. **Depth limit.** If the stack already holds `maxStackDepth` items
   **(configurable, default 8)**, no new responses are legal.

### 5.3 What responses can do

A response is an ordinary stack item. Its effects may target **items still on
the stack** with these primitives:

- `counter`: the item is removed when it would resolve, per §3 step 1.
- `cancel`: the same as `counter`, but the source is not "countered" for
  triggers.
- `redirect(newTarget)`: changes the item's bound target.
- `modify(param, op)`: changes a parameter, e.g. damage −2.
- `addBefore` / `addAfter`: adds effects that run around the item's own effects.

Changes to an item are recorded on the item and applied when it resolves.

## 6. Triggers

Triggers come from statuses, permanents, cards in specified zones, units, intents
and game rules. A trigger has an event pattern, an optional condition, a timing
(`when` or `after`) and an effect list.

### 6.1 Interrupts (`when`)

- An interrupt fires **inline** after the step that produced a matching event,
  before the current effect continues.
- It may **halt** the current effect (e.g. stop the remaining movement) and may
  run its own effects. Those effects resolve immediately and fully, including
  their own interrupts and state checks.
- Interrupts cannot be responded to.
- Because interrupts nest, the engine enforces `maxInterruptDepth`
  **(configurable, default 16)**.
- Use interrupts sparingly: traps, hazards, "stop when you enter", "when this
  would be pushed". Authors should default to `after`.

### 6.2 Reactive triggers (`after`)

- A reactive trigger matching an event is **collected** with a snapshot of the
  event and its source (§9.5).
- When the current stack item finishes resolving (§3 step 4), all collected
  triggers are sorted (§6.3) and pushed together so that they resolve in sorted
  order. The new top gets an `itemAnnounced` window, and each one below gets an
  `itemTop` window as it surfaces.
- Triggers collected while a *triggered* item resolves are handled the same way,
  after it finishes.

### 6.3 Ordering

Wherever several modifiers, interrupts or reactive triggers match together,
they are ordered by these keys, in order:

1. **Event order**: the order their matching events were emitted.
2. **Source layer**: game rules, then statuses, then permanents, then
   units' innate abilities, then cards in zones.
3. **Controller**: the active side first, then sides in turn order.
4. **Timestamp**: the sequence number assigned when the source entered play,
   was applied or was created. Lower resolves first.

Every key is part of state, so ordering never depends on JavaScript iteration
order or anything else outside it. Letting a controller choose the order of its
own simultaneous triggers is deferred (see open questions).

### 6.4 Loop limits

An action may perform at most `maxStepsPerAction` steps **(configurable,
default 10,000)**. Exceeding it, or either depth limit, rejects the action with
`ResolutionLimitExceeded` and a trace of the repeating triggers, and leaves the
state unchanged. The editor's validation and scenario runner surface this as a
content error.

## 7. Visibility and reveals

- Each event carries a visibility rule, and `redact(event, viewer)` produces the
  viewer's version. Hidden identities become opaque placeholders, but the
  *kind* of event and its public consequences stay visible: "a face-down card
  was placed", "enemy drew 1".
- **Playing a card reveals it at announcement** (§2 step 3), unless it is played
  face-down.
- **Face-down permanents** (traps, ambushes) stay hidden. Whether their
  *location* is hidden too is set per card **(default: hidden)**.
- **A hidden source reveals itself as the first step of its resolution**: when a
  trap's interrupt fires, or when a face-down card's ability goes on the stack,
  before any of its effects. The `Revealed` event is public.
- Effects that reveal (`reveal`, `peek`, `lookAtTop`) change visibility as a
  step and emit events visible to the viewers they reveal to.
- When hidden cards are shuffled, their opaque ids are reassigned from the
  seeded PRNG, so viewers cannot track them through the shuffle.
- Legality and resolution always use the full authoritative state. A side's
  `legalActions` lists only that side's own options. Fair AIs choose using only
  their projected view.

## 8. Phases and turn structure

- A game defines an ordered list of phases per round, e.g. `roundStart`,
  `intentDeclare`, then for each side `turnStart`, `main`, `turnEnd`, and finally
  `enemyResolve`. **(configurable)**
- A phase change happens only when the stack is empty and there is no prompt.
- Entering a phase emits `PhaseStarted`, then the phase's built-in rule steps
  (e.g. draw to hand size, refill energy) run as effects of a rules-controlled
  stack item. Triggers on phase events follow the normal rules.
- Durations measured in turns tick in `turnEnd` of the duration's controller,
  and expire there, after `turnEnd` triggers resolve.
- During `main`, the active side acts until it takes `endTurn`. Other phases
  advance automatically once their rule steps and triggers have resolved, unless
  a `phaseEnd` window is enabled.

## 9. Permanents

### 9.1 Entering play

A card with a `permanent` section becomes a permanent when it resolves:

1. Its effects run as normal. One of them is the implicit or explicit `enter`
   effect, which creates the entity at its target position.
2. The entity records `sourceCardId`, `owner`, `controller` and a timestamp. The
   card instance moves to the **in-play** zone, keeping its upgrades and
   modifiers.
3. The entity's statics become active at the next state check, which is
   immediately after the `enter` step.
4. `after` triggers such as "on enter" are collected as usual.

### 9.2 Abilities

- **Activated** abilities are actions with a cost and a timing (main-only or a
  reaction window).
- **Triggered** abilities follow §6.
- **Static** abilities follow §9.3.

### 9.3 Statics and derived values

Derived values are never stored. A state check recomputes them from base values
plus active statics, applied in this order:

1. Base value from the definition and any permanent upgrades.
2. **Set** modifiers ("max HP becomes 1"), by timestamp; the last one wins.
3. **Add/subtract** modifiers, summed.
4. **Multiply** modifiers, by timestamp.
5. Floors and caps from the game rules (e.g. a minimum cost of 0).

An aura applies to whatever currently matches its pattern at each
recomputation. Entering or leaving an aura's area therefore takes effect at the
next state check, which is right after the movement step.

### 9.4 Leaving play

A permanent leaves play when it dies (§4), is destroyed or bounced by an effect,
or expires. In order:

1. Remove the entity from the board. Its statics stop at once, because the state
   check that follows recomputes without them.
2. Move its card instance to the leave-play destination: the effect's choice,
   else the card's own setting, else discard. **(configurable per card)**
3. Collect `after` triggers ("on leave", "on death") with a snapshot of the
   entity (§9.5).

### 9.5 Last known information

A trigger whose source or subject has left play uses a **snapshot** taken at
the moment it left: position, controller and derived values. "When this dies,
deal 2 to adjacent units" uses the position where it died.

## 10. Enemy intents

- In `intentDeclare`, each enemy's behaviour picks an intent, using the seeded
  PRNG if it is weighted. Emit `IntentDeclared`, redacted per its intent
  visibility. If the `intentDeclared` window is enabled, it opens once for all
  of the round's declared intents, with priority starting at the side after the
  enemy side.
- An intent's target is either **tile-bound** (it hits the declared tiles,
  wherever units are now) or **unit-bound** (it follows the unit).
  **(per intent, default tile-bound)**
- In `enemyResolve`, intents execute one by one in declaration order. Each one
  is announced as a stack item controlled by the enemy side, so the player may
  respond to it at `itemAnnounced`.
- When it resolves, a unit-bound intent whose target is out of range or gone
  applies its `onInvalidTarget` (default `skip`, emitting `IntentWhiffed`). A
  tile-bound intent simply hits whatever is on its tiles.
- An enemy that dies before its intent executes loses the intent. Emit
  `IntentCancelled`.

## 11. Movement

- Movement is one step per tile. Each step emits `UnitLeftTile` then
  `UnitEnteredTile`, and modifiers, interrupts and state checks run after each
  step. A unit that dies or is halted mid-move stops where it is.
- **Blocked steps.** A step into a blocking tile, an occupied tile or the board
  edge is resolved by the game's collision rule
  **(configurable: `stop` | `bump` | `chain`, default `bump`)**:
  - `stop`: the movement ends.
  - `bump`: the movement ends, and the moving unit and the blocker each take
    `bumpDamage` **(default 1)** as one simultaneous multi-target step. Hitting
    the edge or a wall damages only the mover.
  - `chain`: the blocker is pushed one step in the same direction first (and so
    on down the line), then the mover takes its step. If the front of the chain
    is blocked, the whole chain falls back to `bump`.
- Teleport and swap are single steps and never collide.

## 12. Event stream

Events are emitted in exactly the order the steps applied. Each one carries a
causal path, `actionSeq / itemId / effectIndex / stepIndex`, plus the id of the
interrupt or trigger that produced it, if any. Clients group events for
animation by item and effect, and the debugger (#46) uses the path to show why
each change happened.

---

## Worked examples

The examples use these defaults unless they say otherwise: collision `bump` with
bump damage 1, max HP clamping, no response windows, and 4-connected square
grids, where distance is Manhattan distance and positions are (x, y) with east
being +x. P is the player's unit,
E1, E2… are enemies, and "→" shows the order things happen in.

### E1. A push into a hazard triggers on-damage card draw

Setup: a lane, laid out as `P E1 H W`. H is a hazard tile with the interrupt
"when a unit enters, deal it 2". W is a wall. The player has the status
*Opportunist*: "after an enemy takes damage from terrain, draw 1" (`after`).
E1 has 6 HP. The player plays **Shove** (push target 2).

1. Shove is announced and moves to the resolving zone.
2. Effect `push E1 2`, step 1: E1 moves onto H → `UnitEnteredTile`
   → H's interrupt deals 2 (no modifiers apply) → `DamageDealt(E1, 2, source=terrain)`
   → *Opportunist* matches this event, so a draw trigger is collected
   → state check: E1 is at 4 HP and alive.
3. Step 2: W blocks the move → bump → `DamageDealt(E1, 1, source=collision)`.
   This damage is not terrain damage, so nothing is collected. State check: 3 HP.
4. The effect ends. Shove moves to discard → `ItemResolved`.
5. The collected trigger goes on the stack and resolves: draw 1.

**Outcome:** E1 is on H with 3 HP and the player has drawn exactly 1 card.
Shove is already in the discard pile before the draw, so if the deck was empty,
the reshuffle includes Shove.

### E2. Lethal damage halts movement mid-push

Same as E1, but E1 has 2 HP.

1. Step 1: E1 enters H and takes 2 → state check: E1 dies →
   `UnitDied(E1)` → E1 leaves play.
2. The push's subject is gone (§3 step 3.2.5), so step 2 never happens and
   there is no bump.
3. *Opportunist*'s trigger was collected before the death and still resolves:
   draw 1.

**Outcome:** E1 is dead on H, no collision happened, and 1 card was drawn.

### E3. A trap springs during a reaction's movement, and the intent then whiffs

Setup: a square grid. P is at (2,2) and E1 at (2,3). E1 has declared a
**unit-bound**, melee-range intent "Strike P for 5". The player owns a
single-use, face-down trap T at (3,3) with the interrupt "when an enemy enters,
root it and deal 3". The `itemAnnounced` window is enabled. The player holds
**Sidestep**, a reaction: "Move an attacking enemy 1 tile."

1. `enemyResolve`: Strike is announced and controlled by the enemy side, so
   priority goes to the player first. The player responds with Sidestep, moving
   E1 one tile east.
2. Sidestep is announced, and the enemy side gets priority. It has no legal
   response, so it auto-passes, and so does the player. Sidestep resolves.
3. Step: E1 enters (3,3) → T's interrupt fires. Its first step is `Revealed(T)`,
   which is public. Then root, and `DamageDealt(E1, 3)` → state check.
4. Sidestep moves to discard. Strike becomes the top again and gets an `itemTop`
   window. Neither side has a legal response, so both auto-pass.
5. Strike resolves: P is no longer in E1's melee range, so the intent's
   `onInvalidTarget: skip` applies → `IntentWhiffed`.

**Outcome:** P takes no damage, E1 is rooted at (3,3) having taken 3 damage, and
T is revealed and, being single-use, leaves play to the discard pile. Before step 3, the enemy view
contains no T at all.

### E4. Destroying an aura mid-resolution clamps HP

Setup: the ally A has base max HP 3, and the player's Totem aura gives "+2 max HP
to adjacent allies". A is at 4/5. An enemy card resolves: "Destroy target
structure. Then deal 1 damage to each unit adjacent to it."

1. Effect 1 destroys the Totem → state check: the Totem leaves play →
   recompute statics: A's max HP is now 3 → clamp: A goes to 3/3.
2. Effect 2: the Totem's position comes from last known information →
   `DamageDealt(A, 1)` → A is at 2/3.

**Outcome:** A is at 2/3. If the effects were the other way round, damage first
and then destroy, A would go from 4/5 to 3/5 and then clamp to 3/3. Effect order
is the author's to choose and is always respected.

### E5. A reaction is countered, and the player responds again

Setup: response windows `itemAnnounced` and `itemTop` are enabled. E1 announces
"Strike P for 5". The player holds **Parry** (reaction: counter an attack
targeting you) and **Brace** (reaction: gain 3 block). E1 has the ability
**Disrupt**, a reaction used once per round: "counter a player reaction".

1. Strike is announced and the player has priority. The player plays Parry.
   The stack is now [Strike, Parry].
2. Parry is announced, and the enemy has priority first. It plays Disrupt
   targeting Parry. The stack is now [Strike, Parry, Disrupt].
3. Disrupt is announced and the player has priority, but has no legal response
   to Disrupt (Brace only responds to attacks), so the player passes, then the
   enemy passes. Disrupt resolves and marks Parry countered.
4. `itemTop` for Parry: both sides pass. Parry resolves as countered →
   `ItemCountered`, and Parry goes to discard with none of its effects.
5. `itemTop` for Strike: the player has priority again and plays Brace, which
   resolves, giving 3 block.
6. Strike resolves: block absorbs 3, then `DamageDealt(P, 2)`.

**Outcome:** P takes 2 damage, and Parry and Brace are both in discard. This shows
LIFO resolution and that a player gets to respond again when an item becomes
the top.

### E6. Simultaneous deaths and their death triggers

Setup: a lane, laid out as `P E1 E2 E3`. E1 has 2 HP and "after this dies, deal 2
to adjacent units". E2 has 2 HP and "after this dies, heal adjacent allies 3".
E3 is at 4/8. The player plays **Sweep**: deal 2 to all enemies.

1. The multi-target step hits E1, E2 and E3 in board order. After all three, one
   state check runs: E1 and E2 die simultaneously and emit `UnitDied` in board
   order (E1, then E2). E3 is at 2/8.
2. Sweep resolves and two triggers have been collected. Sorting by event order
   puts E1's trigger first, so it resolves first.
3. E1's explosion uses last known information (position 1): it hits P and E2's
   tile, which is now empty, so only `DamageDealt(P, 2)` happens.
4. E2's heal uses last known information (position 2): E3 is adjacent and heals
   to 5/8.

**Outcome:** P takes 2 damage and E3 is at 5/8.

### E7. Block, fully blocked hits and "on damage" triggers

Setup: P has 5 block and the status *Thorns*: "after you are attacked, deal 1
to the attacker". P also has the status *Grit*: "after you take damage, gain 1
energy". E1 attacks P for 5.

1. Block is a modifier. It absorbs 5 → `BlockLost(P, 5)`. The damage step is
   reduced to 0.
2. A 0-damage step emits `AttackBlocked`, not `DamageDealt`.
3. *Grit* does not trigger. *Thorns* matches on the attack itself
   (`AttackResolved`), so it triggers and deals 1 to E1.

**Outcome:** P takes 0 damage, gains no energy, and has 0 block; E1 takes 1.
Authors choose between "when attacked" and "when damaged" triggers.

### E8. Drawing past the end of the deck reshuffles mid-effect

Setup: the deck holds 1 card and the discard holds 4. The player plays
**Insight**: "Draw 3". The discard pile holds no copy of Insight; the one being
played is in the resolving zone.

1. Draw 1 card, which empties the deck.
2. Draw 2: the deck is empty, so the 4 discarded cards are shuffled into the
   deck using the seeded PRNG → `DeckShuffled`. The enemy view gets new opaque
   ids. Then draw.
3. Draw 3.
4. Insight goes to discard.

**Outcome:** the player has 3 new cards, the deck holds 2, and the discard holds
Insight. The same seed always produces the same 3 cards.

### E9. When a variable is evaluated

Setup: the hand holds **Purge** and 4 other cards. Purge says: "Discard your
hand. Deal 2 damage per card discarded."

- Written with `discarded.count` from effect 1, it deals 8. Evaluating
  `X = cards in hand` when effect 2 starts would give 0, because the hand is
  already empty. Authors use the produced variable, and the editor's card text
  preview shows "(8)".
- With `bind: "onPlay"` on `X = cards in hand`, it also deals 8: the snapshot
  is 4, taken after Purge left the hand.

**Outcome:** both forms deal 8. A bare `X = cards in hand` deals 0. The
validator warns when a variable that reads a zone is used after an effect that
empties that zone.

### E10. Collision rules and chain pushes

Setup: a lane, laid out as `P E1 E2 _`. The player plays push E1 1 east.

- `stop`: nothing moves.
- `bump`: E1 and E2 each take 1 damage, simultaneously. Nothing moves.
- `chain`: E2 steps into the empty tile first, then E1 steps to E2's old tile.
  Neither takes damage. If the last tile were a wall instead, the chain would
  fall back to `bump`.

### E11. Tile-bound and unit-bound intents when the target moves

Setup: E1 declares "Slam tiles (1,1)-(1,3) for 4", which is tile-bound, and E2
declares "Shoot P for 3, range 3", which is unit-bound. In `main`, P moves from
(1,2) to (3,4).

- Slam hits the declared tiles. P isn't there, so nothing takes damage
  (`IntentResolved` with no hits).
- Shoot follows P. The distance is now 4, which exceeds range 3, so
  `onInvalidTarget: skip` applies → `IntentWhiffed`.

**Outcome:** P takes no damage. A tile-bound intent can still hit any other unit
standing on its tiles, including enemies.

### E12. An infinite trigger loop is rejected

Setup: the player's permanent Mirror says "after an enemy takes damage, deal 1
damage to a random enemy". The enemies have large amounts of HP. The player
deals 1 damage to E1.

1. That damage collects Mirror's trigger. Its damage collects Mirror's trigger
   again, and so on, so the steps never stop.
2. At step 10,001 the engine aborts with `ResolutionLimitExceeded`, including a
   trace that shows the Mirror → Mirror cycle.

**Outcome:** the player's action is rejected and the state is identical to
before it. In the editor, the scenario runner reports this as a content error on
Mirror. Cycles between several sources are caught the same way.

### E13. A hidden trap in fair-AI and cheating-AI views

Setup: the player places **Snare** face-down at (4,4). Its location is hidden by
default.

- The enemy view contains neither Snare nor any marker on (4,4). The enemy
  receives `CardPlayed(hidden)` from the player's hand: the player's hand count
  drops by 1, but the card and its destination are not shown.
- A fair-view AI plans its path through (4,4), and the trap springs per E3.
- A cheating AI uses the full state and routes around (4,4). This is a
  difficulty choice set per AI.

### E14. A game with no reactions never pauses

Setup: no response windows are enabled. E1's intent resolves while the player
holds a card with reaction timing.

1. Announcement opens no window and resolution proceeds straight through, with
   no `prompt` in state.
2. The reaction card is never legal, because no window ever opens.

**Outcome:** `apply` returns a final state with no pause. The state hash matches
a run of the same game built with no reaction cards at all.

---

## Open questions for the owner

1. **Ordering your own simultaneous triggers.** Should a controller be able to
   choose the order of its own simultaneous reactive triggers, as in many CCGs?
   It adds a prompt type, and the fixed ordering in §6.3 avoids it. I recommend
   deferring until content needs it.
2. **Loop limit during real play.** §6.4 rejects the whole action. An
   alternative is to end the game as a draw. Rejecting is friendlier while
   developing content; a draw may be fairer once multiplayer exists (#51).
3. **Defaults.** Are `bump` collision and tile-bound intents the right defaults
   for the reference game (#30)? Both are easy to change per game.
