/**
 * The editor's in-memory project (#39): a game package's manifest, content
 * items, assets and any other files, opened leniently so broken content can
 * still be fixed in the editor. Projects are immutable values; commands
 * return new projects that share unchanged items.
 */
import {
  CONTENT_KINDS,
  MANIFEST_PATH,
  migrator as defaultMigrator,
  parseJson,
  serializeItem,
  type ContentItem,
  type ContentKind,
  type Manifest,
  type Migrator,
} from '@ccg/content';

/** A project's files: '/'-separated paths relative to the package root. */
export type Files = Record<string, Uint8Array>;

export interface Project {
  manifest: Manifest;
  /** Items keyed `kind:id`. */
  items: Readonly<Record<string, ContentItem>>;
  /** Each item's file path, keyed `kind:id`. */
  paths: Readonly<Record<string, string>>;
  assets: Readonly<Record<string, Uint8Array>>;
  /** Files the editor does not edit (code, docs, content it could not parse); saved unchanged. */
  other: Readonly<Record<string, Uint8Array>>;
}

/** Content folder for each kind, as in the package layout (#34). */
export const KIND_FOLDERS: Readonly<Record<ContentKind, string>> = {
  card: 'cards',
  unit: 'units',
  status: 'statuses',
  tile: 'tiles',
  encounter: 'encounters',
  ruleset: 'rulesets',
};

export const itemKey = (kind: ContentKind, id: string) => `${kind}:${id}`;

export function splitKey(key: string): { kind: ContentKind; id: string } {
  const i = key.indexOf(':');
  return { kind: key.slice(0, i) as ContentKind, id: key.slice(i + 1) };
}

export const defaultPath = (kind: ContentKind, id: string) => `content/${KIND_FOLDERS[kind]}/${id}.json`;

const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const encodeText = (text: string) => encoder.encode(text);
export const decodeText = (bytes: Uint8Array) => decoder.decode(bytes);

/** A file the editor could not read as content, with why. */
export interface OpenIssue {
  file: string;
  message: string;
}

export type OpenResult = { ok: true; project: Project; issues: OpenIssue[]; migrated: string[] } | { ok: false; message: string };

const isKind = (v: unknown): v is ContentKind => typeof v === 'string' && (CONTENT_KINDS as readonly string[]).includes(v);

/**
 * Opens a project from its files. Only a readable game.json is required:
 * content that fails its schema is still opened (validation reports it), and
 * files that are not content at all are kept as they are.
 */
export function openProject(files: Files, migrator: Migrator = defaultMigrator): OpenResult {
  const manifestFile = files[MANIFEST_PATH];
  if (!manifestFile) return { ok: false, message: `missing ${MANIFEST_PATH}` };
  const manifestJson = parseJson(decodeText(manifestFile));
  if (!manifestJson.ok) return { ok: false, message: `${MANIFEST_PATH}: ${manifestJson.message}` };
  const manifest = migrator.migrate(manifestJson.value);
  if (!manifest.ok) return { ok: false, message: `${MANIFEST_PATH}: ${manifest.message}` };

  const project: { manifest: Manifest; items: Record<string, ContentItem>; paths: Record<string, string>; assets: Files; other: Files } = {
    manifest: manifest.doc as unknown as Manifest,
    items: {},
    paths: {},
    assets: {},
    other: {},
  };
  const issues: OpenIssue[] = [];
  const migrated: string[] = manifest.migrated ? [MANIFEST_PATH] : [];

  for (const path of Object.keys(files).sort()) {
    const bytes = files[path] as Uint8Array;
    if (path === MANIFEST_PATH) continue;
    if (path.startsWith('assets/')) {
      project.assets[path] = bytes;
      continue;
    }
    if (!path.startsWith('content/') || !path.endsWith('.json')) {
      project.other[path] = bytes;
      continue;
    }
    const keep = (message: string) => {
      issues.push({ file: path, message });
      project.other[path] = bytes;
    };
    const json = parseJson(decodeText(bytes));
    if (!json.ok) {
      keep(json.message);
      continue;
    }
    const doc = migrator.migrate(json.value);
    if (!doc.ok) {
      keep(doc.message);
      continue;
    }
    const item = doc.doc as Partial<ContentItem>;
    if (!isKind(item.kind) || typeof item.id !== 'string' || item.id === '') {
      keep('not a content item: it needs a known kind and an id');
      continue;
    }
    const key = itemKey(item.kind, item.id);
    if (project.items[key]) {
      keep(`duplicate ${item.kind} id '${item.id}' (also in ${project.paths[key]})`);
      continue;
    }
    if (doc.migrated) migrated.push(path);
    project.items[key] = item as ContentItem;
    project.paths[key] = path;
  }
  return { ok: true, project, issues, migrated };
}

/** The files a project saves as. Content and the manifest use the deterministic format. */
export function projectFiles(project: Project): Files {
  const files: Files = { ...project.other, ...project.assets, [MANIFEST_PATH]: encodeText(serializeItem(project.manifest)) };
  for (const [key, item] of Object.entries(project.items)) files[project.paths[key] as string] = encodeText(serializeItem(item));
  return files;
}

/** Items of one kind, sorted by name then id, for browsers and pickers. */
export function itemsOfKind(project: Project, kind: ContentKind): [string, ContentItem][] {
  return Object.entries(project.items)
    .filter(([, item]) => item.kind === kind)
    .sort(([, a], [, b]) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));
}
