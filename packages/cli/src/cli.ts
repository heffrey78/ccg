#!/usr/bin/env node
/**
 * `ccg`: command-line tools for game packages (#46).
 *
 *   ccg validate <dir>   check a package's content, as the game loader does
 *   ccg test <dir>       run its scenarios with expectations as regression tests
 *
 * Exits non-zero on any problem or failing scenario, so CI can run it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { filesSource, type PackageFiles } from '@ccg/content';
import { PackageRegistry, runScenarios, type ResolvedGame } from '@ccg/core';

export interface Io {
  out(line: string): void;
  err(line: string): void;
}

const USAGE = 'usage: ccg <validate|test> <package dir>';
const SKIP = new Set(['node_modules', '.git', 'dist']);

function readPackage(dir: string): PackageFiles {
  const files: PackageFiles = {};
  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      if (SKIP.has(name)) continue;
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else files[relative(dir, path).split(sep).join('/')] = new Uint8Array(readFileSync(path));
    }
  };
  walk(dir);
  return files;
}

async function load(dir: string, io: Io): Promise<ResolvedGame<unknown> | null> {
  const registry = new PackageRegistry();
  const loaded = await registry.loadFiles(filesSource(readPackage(dir)));
  const issues = loaded.ok ? (() => {
    const resolved = registry.resolve(loaded.package.manifest.id);
    return resolved.ok ? { game: resolved.game, issues: [] } : { game: null, issues: resolved.issues };
  })() : { game: null, issues: loaded.issues };
  for (const i of issues.issues) io.err(`${i.file ?? 'game.json'}${i.pointer ? ` ${i.pointer}` : ''}: ${i.message}`);
  return issues.game;
}

export async function main(argv: string[], io: Io = { out: (l) => console.log(l), err: (l) => console.error(l) }): Promise<number> {
  const [command, target] = argv;
  if (!target || (command !== 'validate' && command !== 'test')) {
    io.err(USAGE);
    return 2;
  }
  const dir = resolve(target);
  let game: ResolvedGame<unknown> | null;
  try {
    game = await load(dir, io);
  } catch (error) {
    io.err(`cannot read ${target}: ${(error as Error).message}`);
    return 1;
  }
  if (!game) return 1;
  if (command === 'validate') {
    io.out(`${game.root.name} ${game.root.version}: no problems`);
    return 0;
  }
  const results = runScenarios(game);
  if (results.length === 0) {
    io.out(`${game.root.name}: no scenarios with expectations`);
    return 0;
  }
  for (const r of results) {
    io.out(`${r.passed ? '✓' : '✗'} ${r.name} (${r.id})`);
    for (const f of r.failures) io.out(`    ${f}`);
  }
  const failed = results.filter((r) => !r.passed).length;
  io.out(`${results.length} scenario${results.length === 1 ? '' : 's'}: ${results.length - failed} passed, ${failed} failed`);
  return failed === 0 ? 0 : 1;
}

// Run when executed directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main(process.argv.slice(2)).then((code) => process.exit(code));
}
