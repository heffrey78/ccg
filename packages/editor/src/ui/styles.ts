/** The editor's stylesheet; colours are tokens on `.ccg-editor` so hosts can theme it. */
export const CSS = `
.ccg-editor {
  --bg: #f6f4ef; --panel: #ffffff; --ink: #1d1c1a; --muted: #6b675f; --line: #d9d4c9;
  --accent: #2f6fb3; --danger: #b8432f; --warn: #c8462f; --select: #e6eef8; --hl: #fff1b8;
  --shadow: 0 1px 2px #0000001f, 0 2px 8px #00000014;
  font-family: system-ui, sans-serif; color: var(--ink); background: var(--bg);
}
@media (prefers-color-scheme: dark) {
  .ccg-editor {
    --bg: #17181b; --panel: #212328; --ink: #ecebe8; --muted: #9b9a96; --line: #373a41;
    --accent: #5b9be0; --danger: #e0644b; --warn: #e0644b; --select: #26364a; --hl: #4a4220;
    --shadow: 0 1px 2px #0006, 0 2px 8px #0004;
  }
}
.ccg-editor button, .ccg-editor .ccg-file-button { font: inherit; color: inherit; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 5px 10px; cursor: pointer; }
.ccg-editor button:disabled { opacity: .5; cursor: default; }
.ccg-editor button:focus-visible, .ccg-editor input:focus-visible { outline: 3px solid var(--accent); outline-offset: 1px; }
.ccg-editor input:not([type]), .ccg-editor input[type="search"] { font: inherit; color: inherit; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 5px 8px; }
.ccg-editor .ccg-primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.ccg-editor .ccg-danger { color: var(--danger); border-color: var(--danger); }
.ccg-editor .ccg-link { border: none; background: none; padding: 0; color: var(--accent); text-decoration: underline; }
.ccg-editor .ccg-muted { color: var(--muted); }
.ccg-editor .ccg-error { color: var(--danger); margin: 4px 0; }
.ccg-editor code { font-size: .85em; }
.ccg-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.ccg-spacer { flex: 1; }
.ccg-panel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px 16px; box-shadow: var(--shadow); margin-bottom: 16px; }
.ccg-panel h2 { margin-top: 0; font-size: 1.1rem; }
.ccg-panel label { display: block; margin-bottom: 8px; }
.ccg-panel fieldset { border: none; padding: 0; margin: 8px 0 12px; }
.ccg-radio { display: block; }
.ccg-file-button input { display: none; }
.ccg-project-list { padding-left: 0; list-style: none; }
.ccg-project-list li { margin-bottom: 6px; }

.ccg-workspace { display: flex; flex-direction: column; gap: 10px; }
.ccg-toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.ccg-toolbar h1 { margin: 0; font-size: 1.3rem; }
.ccg-editor-main { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 12px; align-items: start; }
@media (max-width: 760px) { .ccg-editor-main { grid-template-columns: 1fr; } }
.ccg-browser, .ccg-editor-center, .ccg-validation, .ccg-confirm { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; box-shadow: var(--shadow); }
.ccg-browser { display: flex; flex-direction: column; gap: 6px; max-height: 70vh; overflow: auto; }
.ccg-browser summary { font-weight: 600; cursor: pointer; display: flex; gap: 6px; align-items: center; }
.ccg-browser ul { list-style: none; margin: 2px 0 6px; padding-left: 8px; }
.ccg-editor .ccg-add { margin-left: auto; padding: 0 8px; }
.ccg-editor .ccg-tree-item { width: 100%; text-align: left; border-color: transparent; background: none; padding: 3px 6px; }
.ccg-editor .ccg-tree-item.is-selected { background: var(--select); border-color: var(--line); }
.ccg-issue-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--warn); margin-left: 6px; }
.ccg-tags { display: flex; gap: 4px; flex-wrap: wrap; }
.ccg-editor .ccg-tag { padding: 1px 8px; border-radius: 999px; font-size: .8rem; }
.ccg-editor .ccg-tag[aria-pressed="true"] { background: var(--accent); color: #fff; border-color: var(--accent); }
.ccg-new-item { display: flex; flex-direction: column; gap: 6px; padding: 6px; border: 1px dashed var(--line); border-radius: 8px; margin: 4px 0; }
.ccg-item-header { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.ccg-item-header h2 { margin: 0; }
.ccg-kind { font-size: .8rem; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
.ccg-fields { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; margin: 10px 0; }
.ccg-field { display: flex; flex-direction: column; gap: 2px; font-size: .9rem; }
.ccg-item-panel .ccg-field { margin-bottom: 8px; }
.ccg-issues-inline { list-style: none; padding: 0; }
.ccg-editor .ccg-issues-inline button { border-color: var(--warn); color: var(--warn); text-align: left; }
.ccg-json { background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 10px; overflow: auto; max-height: 50vh; font-size: .85rem; }
.ccg-json .is-highlighted, .ccg-json .is-highlighted-line { background: var(--hl); outline: 2px solid var(--warn); border-radius: 3px; }
.ccg-json-key { color: var(--accent); }
.ccg-json-string { color: #3c8a4f; }
.ccg-json-number { color: #a35a00; }
.ccg-validation h2 { margin: 0 0 4px; font-size: 1rem; }
.ccg-validation ul { margin: 0; padding-left: 18px; max-height: 200px; overflow: auto; }
.ccg-badge { display: inline-block; min-width: 1.4em; text-align: center; border-radius: 999px; padding: 0 6px; background: var(--line); font-size: .85rem; }
.ccg-badge.is-bad { background: var(--warn); color: #fff; }
.ccg-confirm { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.ccg-confirm p { margin: 0; }
/* generated forms (#40) */
.ccg-editor select, .ccg-editor textarea, .ccg-editor input[type="number"], .ccg-editor input:not([type]) { font: inherit; color: inherit; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 4px 6px; }
.ccg-editor input[type="number"] { width: 6em; }
.ccg-editor textarea { width: 100%; min-height: 4em; font-family: ui-monospace, monospace; }
.ccg-card-preview { background: var(--select); border-radius: 8px; padding: 8px 12px; font-style: italic; }
.ccg-form-object { display: flex; flex-direction: column; gap: 6px; }
.ccg-form-row { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 8px; align-items: start; padding: 2px 4px; border-radius: 6px; }
.ccg-form-row.is-block { grid-template-columns: 1fr; }
.ccg-form-row.is-block > .ccg-form-control { padding-left: 12px; border-left: 2px solid var(--line); }
.ccg-form-help { margin: 4px 0 0; font-size: .85rem; }
.ccg-form-row.has-error { background: color-mix(in srgb, var(--warn) 8%, transparent); }
.ccg-form-row.is-flagged, .ccg-effect.is-flagged { outline: 2px solid var(--warn); background: var(--hl); }
.ccg-form-label { display: flex; gap: 6px; align-items: center; font-size: .9rem; font-weight: 600; min-height: 28px; }
.ccg-form-actions { display: inline-flex; gap: 2px; }
.ccg-editor .ccg-form-actions button, .ccg-editor .ccg-form-remove, .ccg-editor .ccg-var-toggle { padding: 0 6px; font-size: .8rem; }
.ccg-editor .ccg-var-toggle[aria-pressed="true"] { background: var(--accent); color: #fff; border-color: var(--accent); }
.ccg-form-optional { display: flex; gap: 4px; flex-wrap: wrap; }
.ccg-editor .ccg-form-add { border-style: dashed; color: var(--muted); padding: 2px 8px; font-size: .85rem; }
.ccg-form-union { display: flex; flex-direction: column; gap: 6px; }
.ccg-form-union > select { align-self: flex-start; }
.ccg-form-list { display: flex; flex-direction: column; gap: 4px; }
.ccg-effects ol { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.ccg-effect { border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; background: var(--bg); }
.ccg-effect.has-error { border-color: var(--warn); }
.ccg-effect-head { display: flex; gap: 6px; align-items: center; margin-bottom: 4px; }
.ccg-editor .ccg-effect-head button { padding: 0 6px; }
.ccg-effect-text { font-size: .85rem; }
.ccg-palette { border: 1px solid var(--line); border-radius: 8px; padding: 8px; background: var(--panel); box-shadow: var(--shadow); }
.ccg-palette-groups { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; max-height: 300px; overflow: auto; margin-top: 6px; }
.ccg-palette h4 { margin: 0 0 4px; font-size: .8rem; text-transform: uppercase; color: var(--muted); }
.ccg-editor .ccg-palette-groups button { display: block; width: 100%; text-align: left; border-color: transparent; padding: 2px 6px; }
.ccg-editor .ccg-palette-groups button:hover { background: var(--select); }
.ccg-cost { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.ccg-cost-pool { display: inline-flex; gap: 4px; align-items: center; }
.ccg-pattern { display: flex; flex-direction: column; gap: 6px; }
.ccg-pattern-board { width: 100%; max-width: 280px; }
.ccg-pattern-cell { fill: var(--bg); stroke: var(--line); }
.ccg-pattern-cell.is-on { fill: color-mix(in srgb, var(--warn) 55%, var(--bg)); }
.ccg-pattern-cell.is-origin { fill: var(--accent); }
.ccg-pattern-facing { fill: #fff; pointer-events: none; }
.ccg-board-switch { display: inline-flex; }
.ccg-editor .ccg-board-switch button { border-radius: 0; padding: 2px 8px; font-size: .8rem; }
.ccg-editor .ccg-board-switch button[aria-checked="true"] { background: var(--accent); color: #fff; border-color: var(--accent); }
.ccg-asset-item { display: flex; gap: 6px; align-items: center; }
.ccg-asset-thumb { object-fit: contain; background: repeating-conic-gradient(var(--line) 0 25%, transparent 0 50%) 0 0 / 8px 8px; border-radius: 4px; }
.ccg-asset-missing, .ccg-asset-icon { display: inline-grid; place-items: center; border: 1px dashed var(--warn); border-radius: 4px; color: var(--muted); }
.ccg-asset-icon { border-color: var(--line); }
.ccg-asset-preview { margin: 8px 0; }
.ccg-playtest { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; box-shadow: var(--shadow); }
.ccg-playtest h2 { margin: 0; font-size: 1.1rem; }
.ccg-playtest .ccg-app { min-height: 0; margin-top: 8px; padding: 8px; border-radius: 8px; }
.ccg-item-form { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: start; }
@media (max-width: 900px) { .ccg-item-form { grid-template-columns: 1fr; } }
.ccg-item-sections { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.ccg-section { border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px 10px; margin: 0; min-width: 0; }
.ccg-section legend { font-weight: 700; padding: 0 4px; }
.ccg-preview { position: sticky; top: 8px; width: 220px; display: flex; flex-direction: column; gap: 6px; }
.ccg-editor .ccg-app.ccg-preview-host { min-height: 0; background: transparent; padding: 0; }
.ccg-status-chip { display: inline-flex; gap: 6px; align-items: center; border: 1px solid var(--line); border-radius: 999px; padding: 4px 10px; background: var(--panel); }
.ccg-behavior { border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: 8px; padding: 4px 8px; background: var(--bg); }
.ccg-behavior.is-if { border-left-color: #a35a00; }
.ccg-behavior.is-sequence { border-left-color: #3c8a4f; }
.ccg-behavior.is-weighted { border-left-color: #7a4bb3; }
.ccg-behavior.has-error { border-color: var(--warn); }
.ccg-behavior.is-flagged { outline: 2px solid var(--warn); }
.ccg-behavior-head { display: flex; gap: 6px; align-items: center; }
.ccg-editor .ccg-behavior-toggle { border: none; background: none; padding: 0 4px; }
.ccg-behavior-summary { color: var(--muted); font-size: .85rem; }
.ccg-behavior-body { margin: 6px 0 2px 12px; display: flex; flex-direction: column; gap: 6px; }
.ccg-behavior-children { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.ccg-behavior-child { display: flex; flex-direction: column; gap: 4px; }
.ccg-preview-rounds { margin: 4px 0; padding-left: 20px; font-size: .9rem; }
.ccg-preview-target { fill: var(--accent); opacity: .55; pointer-events: none; }
.ccg-encounter-board { display: flex; flex-direction: column; gap: 6px; }
.ccg-paint-board { width: 100%; max-width: 520px; }
.ccg-paint-cell-group { cursor: pointer; }
.ccg-paint-cell-group:focus-visible { outline: none; }
.ccg-paint-cell-group:focus-visible .ccg-paint-cell { stroke: var(--accent); stroke-width: 3; }
.ccg-paint-cell { fill: var(--bg); stroke: var(--line); }
.ccg-paint-cell-group:hover .ccg-paint-cell { stroke: var(--accent); }
.ccg-paint-cell.has-tile { fill: color-mix(in srgb, #3c8a4f 30%, var(--bg)); }
.ccg-paint-cell.is-blocking { fill: var(--muted); }
.ccg-paint-tile { font-size: 9px; fill: var(--ink); pointer-events: none; }
.ccg-paint-unit.is-player { fill: var(--accent); }
.ccg-paint-unit.is-enemy { fill: var(--danger); }
.ccg-paint-unit.is-neutral { fill: var(--muted); }
.ccg-paint-label { font-size: 9px; font-weight: 700; fill: #fff; pointer-events: none; }
.ccg-paint-facing { fill: var(--ink); opacity: .7; pointer-events: none; }
.ccg-debugger { margin-top: 10px; border-top: 1px solid var(--line); padding-top: 8px; display: flex; flex-direction: column; gap: 8px; }
.ccg-debugger h3 { margin: 8px 0 4px; font-size: .95rem; }
.ccg-debugger-main { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); gap: 12px; }
@media (max-width: 900px) { .ccg-debugger-main { grid-template-columns: 1fr; } }
.ccg-timeline { margin: 0; padding-left: 28px; max-height: 260px; overflow: auto; font-size: .85rem; }
.ccg-editor .ccg-timeline button { border: none; background: none; padding: 1px 4px; text-align: left; }
.ccg-timeline .is-current { background: var(--select); border-radius: 4px; font-weight: 700; }
.ccg-events { margin: 4px 0; padding-left: 24px; max-height: 200px; overflow: auto; font-size: .8rem; }
.ccg-state { max-height: 420px; overflow: auto; font-family: ui-monospace, monospace; font-size: .8rem; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; }
.ccg-tree-children { padding-left: 14px; }
.ccg-tree-node > summary { cursor: pointer; }
.ccg-tree-node.has-changes > summary { color: var(--warn); }
.ccg-tree-leaf.is-changed { background: var(--hl); outline: 1px solid var(--warn); border-radius: 3px; }
.ccg-balance .ccg-row { margin-bottom: 8px; }
.ccg-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin: 8px 0; }
.ccg-tile { display: flex; flex-direction: column; gap: 2px; border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; background: var(--bg); }
.ccg-tile-label { font-size: .8rem; color: var(--muted); }
.ccg-tile-value { font-size: 1.6rem; color: var(--ink); }
.ccg-charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
.ccg-bars { margin: 0; }
.ccg-bars figcaption { font-weight: 700; margin-bottom: 4px; }
.ccg-bars table { width: 100%; border-collapse: collapse; font-size: .85rem; }
.ccg-bars th { text-align: left; font-weight: 400; color: var(--ink); padding: 2px 8px 2px 0; white-space: nowrap; }
.ccg-bars tr:hover th, .ccg-bars tr:hover .ccg-bar-value { font-weight: 700; }
.ccg-bar-cell { width: 100%; padding: 2px 0; }
.ccg-bar { display: block; height: 10px; min-width: 2px; background: var(--accent); border-radius: 0 4px 4px 0; }
.ccg-bar-value { padding-left: 8px; text-align: right; color: var(--ink); font-variant-numeric: tabular-nums; }
.ccg-map-preview { width: 300px; }
.ccg-raw summary { cursor: pointer; color: var(--muted); margin: 8px 0; }
`;
