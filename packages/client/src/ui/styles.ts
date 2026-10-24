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
@media (max-width: 760px) { .ccg-main { grid-template-columns: 1fr; } }
.ccg-stage { position: relative; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 8px; box-shadow: var(--shadow); }
.ccg-banner { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); margin: 0; padding: 4px 14px; border-radius: 999px; background: var(--ink); color: var(--bg); font-weight: 600; z-index: 1; animation: ccg-pop .2s ease-out; }
.ccg-skip { position: absolute; right: 10px; bottom: 10px; }
.ccg-side { display: flex; flex-direction: column; gap: 12px; }
.ccg-side > section, .ccg-inspector { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; box-shadow: var(--shadow); }
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
.ccg-card-art { width: 100%; border-radius: 6px; }
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
.ccg-run-progress { font-weight: 600; color: var(--accent); }

@media (prefers-reduced-motion: reduce) {
  .ccg-app *, .ccg-app *::before { animation: none !important; transition: none !important; }
}
`;
