/**
 * Loading a game package's source layout (#34):
 *
 *   game.json            manifest
 *   content/**\/*.json    one content item per file, named after its id
 *   assets/**            images, audio...
 *   src/                 optional code entry (ignored here)
 *
 * Files are read through a `FileSource`, so the same loader serves Node, the
 * browser's File System Access API and zip archives.
 */
import type { z } from 'zod';
import { parseJson, serialize } from './format.js';
import { parseRef } from './ids.js';
import { migrator as defaultMigrator, type Migrator } from './migrate.js';
import type { ContentItem, ContentKind, ContentSchemas, Manifest } from './schemas.js';

export interface FileSource {
  /** Every file path, relative to the package root, using '/' separators. */
  list(): Promise<string[]>;
  read(path: string): Promise<string>;
}

export function memorySource(files: Record<string, string>): FileSource {
  return {
    list: async () => Object.keys(files).sort(),
    read: async (path) => {
      const text = files[path];
      if (text === undefined) throw new Error(`no such file: ${path}`);
      return text;
    },
  };
}

/** A problem in a file, located by JSON Pointer (RFC 6901). */
export interface ContentIssue {
  file: string;
  pointer: string;
  message: string;
}

export interface LoadedItem {
  path: string;
  item: ContentItem;
}

export interface LoadedPackage {
  manifest: Manifest | null;
  items: LoadedItem[];
  assets: string[];
  issues: ContentIssue[];
  /** Files whose formatVersion was upgraded while loading; save them to persist. */
  migrated: string[];
}

export const MANIFEST_PATH = 'game.json';

export async function loadPackage(
  source: FileSource,
  schemas: ContentSchemas,
  migrator: Migrator = defaultMigrator,
): Promise<LoadedPackage> {
  const paths = await source.list();
  const result: LoadedPackage = { manifest: null, items: [], assets: [], issues: [], migrated: [] };

  const read = async (path: string, schema: z.ZodType): Promise<unknown> => {
    const parsed = parseJson(await source.read(path));
    if (!parsed.ok) {
      result.issues.push({ file: path, pointer: '', message: parsed.message });
      return undefined;
    }
    const migrated = migrator.migrate(parsed.value);
    if (!migrated.ok) {
      result.issues.push({ file: path, pointer: '/formatVersion', message: migrated.message });
      return undefined;
    }
    if (migrated.migrated) result.migrated.push(path);
    const checked = schema.safeParse(migrated.doc);
    if (!checked.success) {
      for (const issue of checked.error.issues) {
        result.issues.push({ file: path, pointer: toPointer(issue.path), message: issue.message });
      }
      return undefined;
    }
    return checked.data;
  };

  if (paths.includes(MANIFEST_PATH)) {
    result.manifest = ((await read(MANIFEST_PATH, schemas.manifest)) as Manifest | undefined) ?? null;
  } else {
    result.issues.push({ file: MANIFEST_PATH, pointer: '', message: 'missing game.json' });
  }

  const seen = new Map<string, string>();
  for (const path of paths) {
    if (path.startsWith('assets/')) {
      result.assets.push(path);
      continue;
    }
    if (!path.startsWith('content/') || !path.endsWith('.json')) continue;
    const item = (await read(path, schemas.item)) as ContentItem | undefined;
    if (!item) continue;

    const basename = path.slice(path.lastIndexOf('/') + 1, -'.json'.length);
    if (basename !== item.id) {
      result.issues.push({ file: path, pointer: '/id', message: `id '${item.id}' must match the file name '${basename}'` });
    }
    const key = `${item.kind}:${item.id}`;
    const previous = seen.get(key);
    if (previous) {
      result.issues.push({ file: path, pointer: '/id', message: `duplicate ${item.kind} id '${item.id}' (also in ${previous})` });
      continue;
    }
    seen.set(key, path);
    result.items.push({ path, item });
  }

  result.issues.push(...checkReferences(result.items, new Set(result.assets)));
  return result;
}

/** The exact text to write for an item or manifest. */
export function serializeItem(item: ContentItem | Manifest): string {
  return serialize(item);
}

/** Local references that point at nothing. References into other packages are checked by the registry (#25). */
function checkReferences(items: LoadedItem[], assets: Set<string>): ContentIssue[] {
  const ids = new Map<ContentKind, Set<string>>();
  for (const { item } of items) {
    const set = ids.get(item.kind) ?? new Set<string>();
    set.add(item.id);
    ids.set(item.kind, set);
  }

  const issues: ContentIssue[] = [];
  for (const { path, item } of items) {
    const expect = (kind: ContentKind, ref: unknown, pointer: string) => {
      if (typeof ref !== 'string') return;
      const parsed = parseRef(ref);
      if (parsed.package === undefined && !ids.get(kind)?.has(parsed.id)) {
        issues.push({ file: path, pointer, message: `unknown ${kind} '${ref}'` });
      }
    };
    const expectAsset = (asset: unknown, pointer: string) => {
      if (typeof asset === 'string' && !assets.has(asset)) {
        issues.push({ file: path, pointer, message: `missing asset '${asset}'` });
      }
    };

    // Art and icons can sit anywhere, e.g. an intent's icon inside a behaviour tree.
    const walk = (node: unknown, pointer: string): void => {
      if (Array.isArray(node)) node.forEach((x, i) => walk(x, `${pointer}/${i}`));
      else if (typeof node === 'object' && node !== null) {
        for (const [key, value] of Object.entries(node)) {
          if ((key === 'art' || key === 'icon') && typeof value === 'string') expectAsset(value, `${pointer}/${escapePointer(key)}`);
          else walk(value, `${pointer}/${escapePointer(key)}`);
        }
      }
    };
    walk(item, '');
    if (item.kind === 'card') {
      (item.keywords as string[] | undefined)?.forEach((k, i) => expect('status', k, `/keywords/${i}`));
    }
    if (item.kind === 'unit') {
      (item.statuses as { status: string }[] | undefined)?.forEach((s, i) =>
        expect('status', s.status, `/statuses/${i}/status`),
      );
    }
    if (item.kind === 'scenario') {
      expect('encounter', item.encounter, '/encounter');
      for (const field of ['hand', 'deck']) (item[field] as string[] | undefined)?.forEach((c, i) => expect('card', c, `/${field}/${i}`));
    }
    if (item.kind === 'ruleset') {
      (item.player as { deck: string[] }).deck.forEach((c, i) => expect('card', c, `/player/deck/${i}`));
    }
    if (item.kind === 'encounter') {
      for (const [pos, tile] of Object.entries((item.tiles as Record<string, string> | undefined) ?? {})) {
        expect('tile', tile, `/tiles/${escapePointer(pos)}`);
      }
      (item.units as { unit: string }[]).forEach((u, i) => expect('unit', u.unit, `/units/${i}/unit`));
      (item.rewards as { cards?: string[] } | undefined)?.cards?.forEach((c, i) =>
        expect('card', c, `/rewards/cards/${i}`),
      );
    }
  }
  return issues;
}

export function toPointer(path: readonly PropertyKey[]): string {
  return path.map((part) => `/${escapePointer(String(part))}`).join('');
}

function escapePointer(part: string): string {
  return part.replace(/~/g, '~0').replace(/\//g, '~1');
}
