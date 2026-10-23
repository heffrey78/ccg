# ccg

An engine and editor for turn-based tactical card games: cards plus movement on
pluggable boards, telegraphed enemy intents, reactions, permanents and hidden
information. Web first, with a Tauri desktop build later. Games are packages
that live in this repo or are published separately.

Planning lives in GitHub issues: requirements, architecture decisions and tasks,
grouped into milestones.

## Layout

| Path | Contents |
| --- | --- |
| `packages/core` | `@ccg/core`, the deterministic rules engine (no DOM) |
| `packages/sdk` | `@ccg/sdk`, the authoring API for game packages |
| `apps/*` | Hosts: web (Vite) and, later, desktop (Tauri) |
| `games/*` | In-repo game packages, built and published like external ones |

## Development

Requires Node 24+ and pnpm (the version is pinned in `package.json`; without a
global install, prefix commands with `npx pnpm@12.15.0`).

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Workspace packages resolve each other's TypeScript source through the
`@ccg/source` export condition, so typecheck and tests don't need a build first.

Code in `packages/core` may not use `Math.random`, `Date`, `performance.now` or
`crypto` randomness; lint enforces this so the engine stays deterministic.
