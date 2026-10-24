/**
 * The client's stylesheet, rendered by App so hosts need no CSS pipeline.
 * Colours are tokens on `.ccg-app`, so a host can theme the UI by
 * overriding them.
 */
export const CSS = `
.ccg-app {
  --bg: #f6f4ef; --panel: #ffffff; --ink: #1d1c1a; --muted: #6b675f; --line: #d9d4c9;
  --cell: #ebe6da; --cell-special: #d9e7d4; --cell-blocking: #8a8478; --threat: #c8462f;
  --mine: #2f6fb3; --enemy: #b8432f; --hp: #3c9a5f; --hp-track: #00000022; --block: #4b7bbd;
  --target: #e0a200; --accent: #2f6fb3; --reaction: #7a4bb3; --shadow: 0 1px 2px #0000001f, 0 2px 8px #00000014;
  font-family: system-ui, sans-serif; color: var(--ink); background: var(--bg); min-height: 100vh;
}
@media (prefers-color-scheme: dark) {
  .ccg-app {
    --bg: #17181b; --panel: #212328; --ink: #ecebe8; --muted: #9b9a96; --line: #373a41;
    --cell: #2a2d33; --cell-special: #2c3a2e; --cell-blocking: #50535b; --threat: #e0644b;
    --mine: #5b9be0; --enemy: #e0644b; --hp: #4fbf7a; --hp-track: #ffffff22; --block: #6f9ee0;
    --target: #f2bf2c; --accent: #5b9be0; --reaction: #a57ae0; --shadow: 0 1px 2px #0006, 0 2px 8px #0004;
  }
}
.ccg-app button { font: inherit; color: inherit; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 6px 12px; cursor: pointer; }
.ccg-app button:disabled, .ccg-app button[aria-disabled="true"] { opacity: .5; cursor: default; }
.ccg-app button:focus-visible, .ccg-app [role="button"]:focus-visible { outline: 3px solid var(--target); outline-offset: 2px; }
.ccg-app .ccg-primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.ccg-muted { color: var(--muted); }
.ccg-import { display: inline-block; margin: 0 0 12px; padding: 6px 12px; border: 1px dashed var(--line); border-radius: 6px; cursor: pointer; }

.ccg-encounter { display: flex; flex-direction: column; gap: 12px; }
.ccg-topbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: baseline; }
.ccg-topbar h1 { margin: 0; font-size: 1.3rem; }
.ccg-turn-status { font-weight: 600; }
.ccg-spacer { flex: 1; }
.ccg-speed select { font: inherit; }

.ccg-main { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 12px; }
@media (max-width: 760px) { .ccg-main { grid-template-columns: 1fr; } .ccg-log ol { max-height: 12rem; overflow-y: auto; } }
/* Beside the board, the side panel takes the board's height and the log scrolls in what is left, so nothing in it pushes the hand down. */
@media (min-width: 761px) {
  .ccg-side { contain: size; overflow-y: auto; }
  .ccg-log { flex: 1 1 0; min-height: 7rem; display: flex; flex-direction: column; }
  .ccg-log ol { flex: 1 1 0; min-height: 0; overflow-y: auto; }
}
.ccg-stage { position: relative; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 8px; box-shadow: var(--shadow); }
.ccg-banner { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); margin: 0; padding: 4px 14px; border-radius: 999px; background: var(--ink); color: var(--bg); font-weight: 600; z-index: 1; animation: ccg-pop .2s ease-out; }
.ccg-side { display: flex; flex-direction: column; gap: 12px; }
.ccg-side > section, .ccg-inspector { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; box-shadow: var(--shadow); }
/* A fixed height, so hovering a unit never moves the log or the hand below it. */
.ccg-inspector { height: 11rem; overflow-y: auto; box-sizing: border-box; }
.ccg-inspector h3 { margin: 0 0 4px; }
.ccg-inspector p { margin: 4px 0; }
.ccg-status-list { margin: 4px 0; padding-left: 18px; }
.ccg-abilities { display: flex; flex-wrap: wrap; gap: 6px; }
.ccg-log h2 { margin: 0 0 4px; font-size: 1rem; }
.ccg-log ol { margin: 0; padding-left: 0; list-style: none; font-size: .9rem; }
.ccg-stack ol { margin: 4px 0 0; padding-left: 18px; }
.ccg-stack .is-countered { text-decoration: line-through; color: var(--muted); }
.ccg-prompt { margin: 0; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-weight: 600; color: var(--reaction); }

.ccg-board { display: block; margin: 0 auto; user-select: none; }
.ccg-cell { fill: var(--cell); stroke: var(--line); stroke-width: 1.5; }
.ccg-cell.is-special { fill: var(--cell-special); }
.ccg-cell.is-blocking { fill: var(--cell-blocking); }
.ccg-cell.is-threatened { stroke: var(--threat); stroke-width: 3; stroke-dasharray: 6 4; }
.ccg-tile-label { font-size: 9px; fill: var(--muted); }
.ccg-unit { cursor: default; }
.ccg-unit[role="button"] { cursor: pointer; }
.ccg-unit-body { stroke: var(--panel); stroke-width: 3; }
.ccg-unit.is-mine .ccg-unit-body { fill: var(--mine); }
.ccg-unit.is-enemy .ccg-unit-body { fill: var(--enemy); }
.ccg-unit.is-neutral .ccg-unit-body { fill: var(--muted); }
.ccg-unit.is-passable { opacity: .55; }
.ccg-unit.is-dying { opacity: .25; }
.ccg-unit.is-selected .ccg-unit-body { stroke: var(--target); stroke-width: 4; }
.ccg-unit-facing { fill: var(--ink); opacity: .7; }
.ccg-unit-name { font-size: 13px; font-weight: 700; fill: #fff; pointer-events: none; }
.ccg-hp-track { fill: var(--hp-track); }
.ccg-hp-fill { fill: var(--hp); transition: width .25s; }
.ccg-hp-text { font-size: 10px; font-weight: 700; fill: var(--ink); }
.ccg-block path { fill: var(--block); stroke: var(--panel); stroke-width: 1.5; }
.ccg-block text { font-size: 10px; font-weight: 700; fill: #fff; }
.ccg-statuses { font-size: 10px; font-weight: 600; fill: var(--reaction); }
.ccg-intent rect { fill: var(--panel); stroke: var(--threat); stroke-width: 2; }
.ccg-intent text { font-size: 11px; font-weight: 700; fill: var(--threat); }
.ccg-intent.is-ally rect { stroke: var(--mine); }
.ccg-intent.is-ally text { fill: var(--mine); }
.ccg-target { cursor: pointer; }
.ccg-target circle, .ccg-target rect, .ccg-target polygon { fill: color-mix(in srgb, var(--target) 18%, transparent); stroke: var(--target); stroke-width: 3; }
.ccg-target.is-focused circle, .ccg-target.is-focused rect, .ccg-target.is-focused polygon { fill: color-mix(in srgb, var(--target) 40%, transparent); stroke-width: 4; }
.ccg-float { font-size: 18px; font-weight: 800; paint-order: stroke; stroke: var(--panel); stroke-width: 4px; animation: ccg-rise .5s ease-out both; pointer-events: none; }
.ccg-float.tone-damage { fill: var(--threat); }
.ccg-float.tone-block { fill: var(--block); }
.ccg-float.tone-heal { fill: var(--hp); }
.ccg-float.tone-status { fill: var(--reaction); }
.ccg-float.tone-info { fill: var(--ink); }
@keyframes ccg-rise { from { transform: translateY(6px); opacity: 0; } to { transform: translateY(-10px); opacity: 1; } }
@keyframes ccg-pop { from { transform: translateX(-50%) scale(.9); opacity: 0; } }

.ccg-tray { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; box-shadow: var(--shadow); display: flex; flex-direction: column; gap: 10px; }
.ccg-tray-info { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; position: relative; }
.ccg-resources { display: flex; gap: 10px; }
.ccg-resource strong { font-size: 1.2rem; color: var(--accent); }
.ccg-piles { display: flex; gap: 6px; flex-wrap: wrap; align-items: flex-start; }
.ccg-pile-list { position: absolute; top: 100%; left: 0; z-index: 2; min-width: 200px; max-height: 260px; overflow: auto; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 6px 12px; box-shadow: var(--shadow); }
.ccg-hand { list-style: none; display: flex; gap: 8px; margin: 0; padding: 0; overflow-x: auto; }
.ccg-app .ccg-card { position: relative; width: 132px; min-height: 140px; display: flex; flex-direction: column; gap: 6px; text-align: left; padding: 8px; border-width: 2px; border-radius: 10px; transition: transform .12s; }
.ccg-app .ccg-card.is-playable:hover { transform: translateY(-4px); }
.ccg-app .ccg-card.is-selected { border-color: var(--target); transform: translateY(-8px); box-shadow: 0 0 0 3px color-mix(in srgb, var(--target) 35%, transparent); }
.ccg-app .ccg-card.is-reaction { border-color: color-mix(in srgb, var(--reaction) 60%, var(--line)); }
.ccg-card.is-preview { position: relative; width: 180px; min-height: 220px; display: flex; flex-direction: column; gap: 6px; padding: 10px; border: 2px solid var(--line); border-radius: 12px; background: var(--panel); box-shadow: var(--shadow); }
.ccg-card-top { display: flex; gap: 6px; align-items: center; }
.ccg-card-cost { display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--accent); color: #fff; font-weight: 700; font-size: .85rem; }
.ccg-card-name { font-weight: 700; }
.ccg-card-art { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 6px; background: var(--cell); }
.ccg-card-text { font-size: .85rem; }
.ccg-card-tags { margin-top: auto; font-size: .75rem; color: var(--muted); text-transform: capitalize; }
.ccg-card-key { position: absolute; right: 6px; bottom: 4px; font-size: .7rem; color: var(--muted); }
.ccg-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; align-items: center; }
.ccg-choices { display: flex; gap: 6px; flex-wrap: wrap; margin-right: auto; }
.ccg-app .ccg-choices .is-focused { border-color: var(--target); }

.ccg-outcome { position: fixed; inset: 0; display: grid; place-content: center; text-align: center; background: color-mix(in srgb, var(--bg) 80%, transparent); z-index: 10; }
.ccg-outcome h2 { font-size: 2.4rem; margin: 0; }
.ccg-rewards { display: flex; gap: 12px; justify-content: center; margin: 12px 0; flex-wrap: wrap; }
.ccg-app .ccg-reward { padding: 0; border: none; background: none; }
.ccg-app .ccg-reward:hover .ccg-card { transform: translateY(-4px); border-color: var(--target); }
.ccg-cell.is-fogged { fill: color-mix(in srgb, var(--ink) 22%, var(--cell)); }
.has-scene .ccg-cell { fill: color-mix(in srgb, var(--cell) 22%, transparent); stroke: color-mix(in srgb, #fff 28%, transparent); }
.has-scene .ccg-cell.is-fogged { fill: color-mix(in srgb, #000 55%, transparent); }
.has-scene .ccg-cell.is-blocking { fill: color-mix(in srgb, var(--cell-blocking) 70%, transparent); }
.ccg-unit-ground { fill: #000; opacity: .28; }
.ccg-unit.is-mine .ccg-unit-ground { fill: var(--mine); opacity: .55; }
.ccg-unit.is-enemy .ccg-unit-ground { fill: var(--enemy); opacity: .5; }
.ccg-unit.is-selected .ccg-unit-ground { stroke: var(--target); stroke-width: 3; opacity: .9; }
.ccg-unit.is-dying .ccg-unit-sprite { filter: grayscale(1); }
.ccg-aura circle { fill: color-mix(in srgb, var(--reaction) 12%, transparent); stroke: var(--reaction); stroke-width: 2; stroke-dasharray: 5 4; pointer-events: none; }
.ccg-aura.is-enemy circle { stroke: var(--enemy); }
.ccg-aura text { font-size: 9px; font-weight: 700; fill: var(--reaction); pointer-events: none; }
.ccg-attachment rect { fill: var(--reaction); stroke: var(--panel); }
.ccg-attachment text { font-size: 8px; font-weight: 700; fill: #fff; pointer-events: none; }
.ccg-respond { position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); margin: 0; padding: 6px 14px; border-radius: 999px; background: var(--reaction); color: #fff; font-weight: 600; z-index: 1; }
.ccg-countdown { opacity: .85; }
.ccg-app .ccg-card.is-eligible { border-color: var(--reaction); box-shadow: 0 0 0 3px color-mix(in srgb, var(--reaction) 40%, transparent); }
.ccg-permanents h2 { margin: 0 0 4px; font-size: 1rem; }
.ccg-permanents ul { margin: 0; padding-left: 16px; }
.ccg-permanents li { margin-bottom: 4px; }
.ccg-run-map { width: min(640px, 90vw); margin: 8px auto; display: block; }
.ccg-thread { fill: none; stroke: color-mix(in srgb, var(--muted) 50%, transparent); stroke-width: 2; }
.ccg-thread.is-walked { stroke: var(--reaction); stroke-width: 3; }
.ccg-thread.is-open { stroke: var(--target); stroke-dasharray: 5 4; }
.ccg-node circle { fill: var(--panel); stroke: var(--line); stroke-width: 2; }
.ccg-node.is-visited circle { fill: color-mix(in srgb, var(--reaction) 25%, var(--panel)); stroke: var(--reaction); }
.ccg-node.is-current circle { stroke-width: 4; }
.ccg-node.is-choice { cursor: pointer; }
.ccg-node.is-choice circle { stroke: var(--target); stroke-width: 3; filter: drop-shadow(0 0 4px var(--target)); }
.ccg-node.is-choice:hover circle, .ccg-node.is-choice:focus-visible circle { fill: color-mix(in srgb, var(--target) 25%, var(--panel)); }
.ccg-node:focus-visible { outline: none; }
.ccg-node-glyph { font-size: 15px; fill: var(--ink); pointer-events: none; }
.ccg-node-name { font-size: 10px; fill: var(--ink); pointer-events: none; }
.ccg-strain { display: block; margin-top: 4px; font-size: .8rem; font-weight: 700; color: var(--reaction); text-transform: capitalize; }
.ccg-services { display: flex; flex-direction: column; gap: 8px; align-items: center; }
.ccg-deck-pick { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; max-height: 60vh; overflow: auto; }
.ccg-app .ccg-deck-pick > button { padding: 0; border: none; background: none; }
.ccg-app .ccg-deck-pick > button:last-child { padding: 6px 12px; border: 1px solid var(--line); background: var(--panel); }
.ccg-run-progress { font-weight: 600; color: var(--accent); }

/* Beat motions (#123): durations divide by the animation speed. */
.ccg-unit-figure { --ccg-beat: calc(420ms / var(--ccg-speed, 1)); }
.ccg-unit-figure.is-lunging { animation: ccg-lunge var(--ccg-beat) ease-in-out; }
.ccg-unit-figure.is-hit { animation: ccg-shake var(--ccg-beat) ease-out; }
.ccg-unit-figure.is-hit .ccg-unit-sprite, .ccg-unit-figure.is-hit .ccg-unit-body { animation: ccg-flash var(--ccg-beat) ease-out; }
.ccg-unit-figure.is-blocked, .ccg-unit-figure.is-bump { animation: ccg-recoil var(--ccg-beat) ease-out; }
.ccg-unit-figure.is-guard, .ccg-unit-figure.is-heal { animation: ccg-swell var(--ccg-beat) ease-out; transform-box: fill-box; transform-origin: 50% 90%; }
.ccg-unit-figure.is-status { animation: ccg-wobble var(--ccg-beat) ease-in-out; transform-box: fill-box; transform-origin: 50% 90%; }
.ccg-unit-figure.is-die { animation: ccg-collapse var(--ccg-beat) ease-in forwards; transform-box: fill-box; transform-origin: 50% 90%; }
@keyframes ccg-lunge { 35% { transform: translate(var(--lx), var(--ly)); } 55% { transform: translate(var(--lx), var(--ly)); } }
@keyframes ccg-shake { 15% { transform: translateX(-6px); } 35% { transform: translateX(5px); } 55% { transform: translateX(-3px); } 75% { transform: translateX(2px); } }
@keyframes ccg-flash { 0%, 30% { filter: brightness(0.7) sepia(1) saturate(9) hue-rotate(-40deg) drop-shadow(0 0 6px var(--threat)); } }
@keyframes ccg-recoil { 30% { transform: translateY(3px) scale(0.97); } }
@keyframes ccg-swell { 40% { transform: scale(1.08); } }
@keyframes ccg-wobble { 25% { transform: rotate(-5deg); } 50% { transform: rotate(4deg); } 75% { transform: rotate(-2deg); } }
@keyframes ccg-collapse { to { transform: translateY(6px) scale(0.6) rotate(-12deg); opacity: 0.3; } }
.ccg-burst { pointer-events: none; --ccg-beat: calc(420ms / var(--ccg-speed, 1)); }
.ccg-burst-ring { fill: none; stroke-width: 3; transform-box: fill-box; transform-origin: center; animation: ccg-ring var(--ccg-beat) ease-out both; }
.ccg-burst-ray { stroke-width: 3; stroke-linecap: round; transform-box: fill-box; animation: ccg-fade var(--ccg-beat) ease-out both; }
.ccg-burst-mote { animation: ccg-mote var(--ccg-beat) ease-out both; }
.ccg-burst.is-hit .ccg-burst-ring, .ccg-burst.is-hit .ccg-burst-ray { stroke: var(--threat); }
.ccg-burst.is-blocked .ccg-burst-ring, .ccg-burst.is-guard .ccg-burst-ring, .ccg-burst.is-blocked .ccg-burst-ray, .ccg-burst.is-guard .ccg-burst-ray { stroke: var(--block); }
.ccg-burst.is-heal .ccg-burst-ring { stroke: var(--hp); }
.ccg-burst.is-heal .ccg-burst-mote { fill: var(--hp); }
.ccg-burst.is-status .ccg-burst-ring { stroke: var(--reaction); }
.ccg-burst.is-status .ccg-burst-mote { fill: var(--reaction); }
.ccg-burst.is-die .ccg-burst-ring, .ccg-burst.is-die .ccg-burst-ray, .ccg-burst.is-bump .ccg-burst-ring, .ccg-burst.is-bump .ccg-burst-ray { stroke: var(--muted); }
.ccg-projectile { fill: var(--threat); stroke: var(--panel); stroke-width: 2; pointer-events: none; filter: drop-shadow(0 0 4px var(--threat)); animation: ccg-shot calc(160ms / var(--ccg-speed, 1)) ease-in both; }
/* A ranged hit waits for its shot, and plays shorter to fit the same beat. */
.ccg-unit-figure.is-ranged, .ccg-burst.is-ranged { --ccg-beat: calc(280ms / var(--ccg-speed, 1)); }
.ccg-burst.is-ranged { animation: ccg-hidden calc(160ms / var(--ccg-speed, 1)) step-end; }
@keyframes ccg-hidden { from, to { visibility: hidden; } }
.ccg-unit-figure.is-ranged, .ccg-unit-figure.is-ranged .ccg-unit-sprite, .ccg-unit-figure.is-ranged .ccg-unit-body, .ccg-burst.is-ranged > *, .ccg-float.is-ranged { animation-delay: calc(160ms / var(--ccg-speed, 1)); }
@keyframes ccg-ring { from { transform: scale(0.3); opacity: 1; } to { transform: scale(1.25); opacity: 0; } }
@keyframes ccg-fade { from { opacity: 1; } to { opacity: 0; } }
@keyframes ccg-mote { from { transform: translate(0, 0); opacity: 1; } to { transform: translate(var(--mx), var(--my)); opacity: 0; } }
@keyframes ccg-shot { from { transform: translate(var(--fx), var(--fy)); opacity: 1; } 90% { opacity: 1; } to { transform: translate(var(--tx), var(--ty)); opacity: 0; } }

@media (prefers-reduced-motion: reduce) {
  .ccg-app *, .ccg-app *::before { animation: none !important; transition: none !important; }
}
`;
