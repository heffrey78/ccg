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
`;
