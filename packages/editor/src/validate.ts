/**
 * Validation (#39): checks a project exactly as the game loader will, by
 * loading its saved files, and ties each issue back to the item it is in.
 * Pure and async, so the web app runs it in a worker.
 */
import { createContentSchemas, loadPackage, mapRefs, parseRef, REF_PATTERN, type OpRegistry } from '@ccg/content';
import { builtinOps } from '@ccg/core';
import { projectFiles, type Project } from './project.js';
import { fileSource } from './stores/store.js';

export interface ProjectIssue {
  file: string;
  /** The item the issue is in (`kind:id`), when it is in one. */
  key?: string;
  /** JSON Pointer within the item or file. */
  pointer: string;
  message: string;
}

/** The op vocabulary content can use: the engine's built-ins (game packages with code add theirs). */
export function editorOps(): OpRegistry {
  return builtinOps();
}

export async function validateProject(project: Project, ops: OpRegistry = editorOps()): Promise<ProjectIssue[]> {
  const loaded = await loadPackage(fileSource(projectFiles(project)), createContentSchemas(ops));
  const byPath = new Map(Object.entries(project.paths).map(([key, path]) => [path, key]));
  const issues: ProjectIssue[] = loaded.issues.map((issue) => {
    const key = byPath.get(issue.file);
    return { ...issue, ...(key && { key }) };
  });
  // The loader checks references in fixed fields; effect parameters are checked
  // by the registry when the game resolves, so check them here too.
  const seen = new Set(issues.map((i) => `${i.file}#${i.pointer}#${i.message}`));
  for (const [key, item] of Object.entries(project.items)) {
    mapRefs(structuredClone(item), ops, (kind, ref, pointer) => {
      if (!REF_PATTERN.test(ref)) return;
      const parsed = parseRef(ref);
      if (parsed.package !== undefined && parsed.package !== project.manifest.id) return;
      if (project.items[`${kind}:${parsed.id}`]) return;
      const issue = { file: project.paths[key] as string, key, pointer, message: `unknown ${kind} '${ref}'` };
      const id = `${issue.file}#${pointer}#${issue.message}`;
      if (!seen.has(id)) issues.push(issue);
      seen.add(id);
    });
  }
  return issues;
}
