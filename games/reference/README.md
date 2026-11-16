# Sporeline

The engine's reference game (#7, design in `docs/design/reference-game.md`): you are a
mycelium on a buried root, rotting, sporing, zombifying and flooding your way through a
fungal network of bug fights to the Weevil Matriarch.

It is a **content-only** package: `game.json`, `content/` and `assets/` (a scene per
encounter, unit sprites and card art, all SVG; replace any file with your own art, SVG or
PNG, under the same path). Its theme, `content/themes/loam.json`, gives it a dark loam
palette, Fraunces headings, a printed table and a card frame per strain (#137).

It looks hand printed. Each card is cream paper stock with its picture cut into a dark
block and its strain printed in one ink: ochre for the Knot, moss for Rotcap, teal for
Puffball, violet for Glowcap, blue for Rootdrinker and rust for Cordyceps. The art in
`assets/` is printed from the flat drawings in `art/` by `scripts/print-art.mjs`, which
drops gradients and glows, snaps colours to those inks, roughens edges and leaves specks
where ink didn't take. To change a picture, edit the drawing in `art/` and run
`node games/reference/scripts/print-art.mjs`; `art/` is not part of the package. It plays on the engine's standard ruleset, was made with the editor's
model and saves in its format, and opens in the editor (Play → Edit, or Editor → Open
folder). Play it in the web client (Play → Sporeline).

Fraunces (`assets/fonts/fraunces-600.woff2`, the latin subset at weight 600) is by The
Fraunces Project Authors and is used under the SIL Open Font License 1.1; the licence is
in `assets/fonts/Fraunces-OFL.txt`.

- `pnpm --filter @ccg/game-reference test` checks it: editor format, validation,
  scenario tests, design requirements and balance guards.
- `pnpm ccg test games/reference` runs its scenario tests.
