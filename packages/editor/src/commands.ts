/**
 * Every change the editor makes is one of these pure functions from a project
 * to a new project, run through the store so it can be undone. A command
 * that cannot apply throws an EditorError with a message for the user.
 */
import { ID_PATTERN, mapRefs, parseRef, type ContentItem, type ContentKind, type Manifest, type OpRegistry } from '@ccg/content';
import { defaultPath, itemKey, splitKey, type Project } from './project.js';

export type Command = (project: Project) => Project;

export class EditorError extends Error {}

const clone = <T>(value: T): T => structuredClone(value);

function requireItem(project: Project, key: string): ContentItem {
  const item = project.items[key];
  if (!item) throw new EditorError(`no item '${key}'`);
  return item;
}

function checkNewId(project: Project, kind: ContentKind, id: string): void {
  if (!ID_PATTERN.test(id)) throw new EditorError(`'${id}' is not a valid id: use lowercase letters, digits, '-' and '_'`);
  if (project.items[itemKey(kind, id)]) throw new EditorError(`a ${kind} with id '${id}' already exists`);
}

export function createItem(item: ContentItem, path = defaultPath(item.kind, item.id)): Command {
  return (project) => {
    checkNewId(project, item.kind, item.id);
    if (Object.values(project.paths).includes(path)) throw new EditorError(`file '${path}' is already used`);
    const key = itemKey(item.kind, item.id);
    return { ...project, items: { ...project.items, [key]: clone(item) }, paths: { ...project.paths, [key]: path } };
  };
}

/** Replaces an item's fields. Its kind and id stay; use renameItem to change the id. */
export function updateItem(key: string, item: ContentItem): Command {
  return (project) => {
    const current = requireItem(project, key);
    if (item.kind !== current.kind || item.id !== current.id) throw new EditorError('updateItem cannot change kind or id; use renameItem');
    return { ...project, items: { ...project.items, [key]: clone(item) } };
  };
}

export function deleteItem(key: string): Command {
  return (project) => {
    requireItem(project, key);
    const { [key]: _item, ...items } = project.items;
    const { [key]: _path, ...paths } = project.paths;
    return { ...project, items, paths };
  };
}

export function duplicateItem(key: string, newId: string): Command {
  return (project) => {
    const source = requireItem(project, key);
    const copy = { ...clone(source), id: newId, name: `${source.name} (copy)` };
    return createItem(copy)(project);
  };
}

/** Whether a reference names this project's item `id` (unqualified, or qualified with this package). */
const refersTo = (ref: string, packageId: string, id: string) => {
  try {
    const parsed = parseRef(ref);
    return parsed.id === id && (parsed.package === undefined || parsed.package === packageId);
  } catch {
    return false;
  }
};

/** Every reference to an item, as `kind:id` of the referring item and a JSON Pointer in it. */
export function referencesTo(project: Project, key: string, ops: OpRegistry): { from: string; pointer: string }[] {
  const { kind, id } = splitKey(key);
  const out: { from: string; pointer: string }[] = [];
  for (const [from, item] of Object.entries(project.items)) {
    mapRefs(clone(item), ops, (refKind, ref, pointer) => {
      if (refKind === kind && refersTo(ref, project.manifest.id, id)) out.push({ from, pointer });
    });
  }
  return out;
}

/**
 * Changes an item's id, renames its file when the file was named after the id,
 * and updates every reference to it in the project.
 */
export function renameItem(key: string, newId: string, ops: OpRegistry): Command {
  return (project) => {
    const item = requireItem(project, key);
    if (newId === item.id) return project;
    checkNewId(project, item.kind, newId);
    const { kind, id } = splitKey(key);
    const newKey = itemKey(kind, newId);

    const items: Record<string, ContentItem> = {};
    const paths: Record<string, string> = {};
    for (const [k, current] of Object.entries(project.items)) {
      let next = current;
      let changed = false;
      const copy = clone(current);
      mapRefs(copy, ops, (refKind, ref) => {
        if (refKind !== kind || !refersTo(ref, project.manifest.id, id)) return undefined;
        changed = true;
        return ref.includes(':') ? `${project.manifest.id}:${newId}` : newId;
      });
      if (changed) next = copy;
      const path = project.paths[k] as string;
      if (k === key) {
        const base = `/${id}.json`;
        items[newKey] = { ...next, id: newId };
        paths[newKey] = path.endsWith(base) ? `${path.slice(0, -base.length)}/${newId}.json` : path;
      } else {
        items[k] = next;
        paths[k] = path;
      }
    }
    if (Object.entries(paths).some(([k, p]) => k !== newKey && p === paths[newKey])) {
      throw new EditorError(`file '${paths[newKey]}' is already used`);
    }
    return { ...project, items, paths };
  };
}

export function updateManifest(manifest: Manifest): Command {
  return (project) => ({ ...project, manifest: clone(manifest) });
}

export function putAsset(path: string, data: Uint8Array): Command {
  return (project) => {
    if (!path.startsWith('assets/')) throw new EditorError(`assets live under assets/, not '${path}'`);
    return { ...project, assets: { ...project.assets, [path]: data } };
  };
}

export function removeAsset(path: string): Command {
  return (project) => {
    if (!project.assets[path]) throw new EditorError(`no asset '${path}'`);
    const { [path]: _removed, ...assets } = project.assets;
    return { ...project, assets };
  };
}
