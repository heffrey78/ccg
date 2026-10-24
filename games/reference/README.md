# Sporeline

The engine's reference game (#7, design in `docs/design/reference-game.md`): you are a
mycelium on a buried root, rotting, sporing, zombifying and flooding your way through a
fungal network of bug fights to the Weevil Matriarch.

It is a **content-only** package: `game.json`, `content/` and `assets/` (its flat-vector
art: a scene per encounter, unit sprites and card art, all SVG; replace any file with
your own art, SVG or PNG, under the same path). It plays on the
engine's standard ruleset, was made with the editor's model and saves in its format, and
opens in the editor (Create → Import zip, or Open folder). Play it in the web client
(Play → Sporeline).

- `pnpm --filter @ccg/game-reference test` checks it: editor format, validation,
  scenario tests, design requirements and balance guards.
- `pnpm ccg test games/reference` runs its scenario tests.
