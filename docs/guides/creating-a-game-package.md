# Creating a game package

A game is a package: a manifest, content, and (optionally) code. Packages made
in the editor are content only (`game.json` plus `content/**/*.json`); code
packages are ordinary npm packages whose default export is a `GamePackage`.
`games/sandbox` is a complete, small example.

## A code package

```ts
import { composeRules, zonesModule, boardModule /* … */ } from '@ccg/core';
import { defineCard, defineGame, defineUnit } from '@ccg/sdk';

export default defineGame({
  manifest: { id: 'my-game', name: 'My Game', version: '0.1.0', engine: '^0.0.0' },
  content: [
    defineCard('jab', { name: 'Jab', targeting: { kind: 'unit', range: 1, filter: 'enemy' }, effects: [{ op: 'damage', amount: 4 }] }),
    defineUnit('hero', { name: 'Hero', hp: 20 }),
  ],
  // Custom ops are namespaced with the package id and validated like built-ins.
  ops: { 'my-game:refill': myRefillOp },
  createRules(game) {
    return composeRules({ round: [/* phases */] }, [/* engine modules */, ...game.modules]);
  },
  createSetup(game, { seed }) {
    return { seed, sides: [/* … */], world: { /* … */ } };
  },
});
```

- **Content ids** are local (`jab`); the registry qualifies them as
  `my-game:jab`. Refer to another package's content as `other-pack:id` and list
  it in `manifest.depends` with a version range.
- **Engine modules** (`zonesModule`, `boardModule`, `statusesModule`,
  `intentsModule`, `permanentsModule`, `stackModule`, `logicModule`) take the
  resolved definitions: `game.definitions.cards`, `.units`, `.statuses`, `.tiles`.
- **Package boundaries:** import only the public entry points `@ccg/core`,
  `@ccg/sdk` and `@ccg/content`. Lint enforces this for packages under `games/`.

## Loading and running it

```ts
const registry = new PackageRegistry();
await registry.import('https://example.com/my-game/index.js'); // or registry.register(pkg)
const result = registry.resolve('my-game');
if (!result.ok) console.error(result.issues); // { package, file, pointer, message }
const rules = result.game.createRules();
const created = createGame(rules, result.game.createSetup({ seed: 1 }));
```

`resolve` checks the engine and dependency ranges, validates every item
against the combined op vocabulary, and reports problems with JSON Pointers.

## Publishing

Packages depend on `@ccg/core` and `@ccg/sdk` as peer dependencies and ship
only `dist/`. `pnpm check:pack` packs every publishable package in the repo and
checks the tarballs; CI runs it on every change. Versioning uses Changesets
(`pnpm changeset`).
