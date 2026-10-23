// Packs every publishable workspace package (as `pnpm publish` would) and
// checks each tarball: only package.json, README/LICENSE and dist/, at least
// one built file, and no `workspace:` ranges left in its package.json (#26).
// Run after `pnpm build`.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'ccg-pack-'));
let failed = false;
try {
  for (const root of ['packages', 'games']) {
    for (const name of readdirSync(root)) {
      const dir = join(root, name);
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      if (manifest.private) continue;
      execFileSync('pnpm', ['pack', '--pack-destination', out], { cwd: dir, stdio: 'pipe' });
      const tarball = join(out, `${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`);
      const files = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
        .trim()
        .split('\n')
        .map((f) => f.replace(/^package\//, ''));
      const packed = execFileSync('tar', ['-xzOf', tarball, 'package/package.json'], { encoding: 'utf8' });
      const problems = [
        ...files.filter((f) => !(f === 'package.json' || /^(README|LICENSE)/i.test(f) || f.startsWith('dist/'))).map((f) => `unexpected file ${f}`),
        ...(files.some((f) => f.startsWith('dist/')) ? [] : ['no dist/ files (run pnpm build first)']),
        ...(packed.includes('workspace:') ? ['package.json still has workspace: ranges'] : []),
      ];
      console.log(`${problems.length ? '✗' : '✓'} ${manifest.name}@${manifest.version} (${files.length} files)`);
      for (const p of problems) console.log(`    ${p}`);
      if (problems.length) failed = true;
    }
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
