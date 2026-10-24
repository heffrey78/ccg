/**
 * Validation (#39): checks a project exactly as the game loader will, by
 * loading its saved files, and ties each issue back to the item it is in.
 * Pure and async, so the web app runs it in a worker.
 */
import { createContentSchemas, loadPackage, mapRefs, parseRef, REF_PATTERN, type OpRegistry } from '@ccg/content';
import { PackageRegistry, builtinOps, runMapIssues, runScenarios, simulate, type RunMap, type GameRecord, type ScenarioResult, type SimOptions } from '@ccg/core';
import { boardIssues, projectBoard } from './encounters.js';
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
  // A run map must be walkable: known nodes, fights with encounters, no loops.
  for (const [key, item] of Object.entries(project.items)) {
    const run = item.kind === 'ruleset' ? (item.run as { map?: RunMap; encounters?: string[] } | undefined) : undefined;
    if (run && !run.map && !(run.encounters && run.encounters.length > 0)) {
      issues.push({ file: project.paths[key] as string, key, pointer: '/run', message: 'a run needs encounters in order or a map' });
    }
    const map = run?.map;
    if (map && Array.isArray(map.nodes)) {
      for (const issue of runMapIssues(map)) issues.push({ file: project.paths[key] as string, key, pointer: `/run/map${issue.pointer}`, message: issue.message });
    }
  }
  // Encounters must fit the board the ruleset describes.
  const board = projectBoard(project);
  if (board) for (const issue of boardIssues(project, board)) issues.push({ ...issue, file: project.paths[issue.key] as string });
  return issues;
}

/** Runs the project's scenarios that have expectations (#46), as the `ccg test` CLI does. */
export async function testProject(project: Project): Promise<ScenarioResult[]> {
  const registry = new PackageRegistry();
  const loaded = await registry.loadFiles(fileSource(projectFiles(project)));
  if (!loaded.ok) throw new Error(loaded.issues.map((i) => `${i.file ?? ''}${i.pointer}: ${i.message}`).join('\n'));
  const resolved = registry.resolve(loaded.package.manifest.id);
  if (!resolved.ok) throw new Error(resolved.issues.map((i) => `${i.file ?? ''}${i.pointer}: ${i.message}`).join('\n'));
  return runScenarios(resolved.game);
}

/** Plays the project's encounter many times with a bot (#47). Web hosts split the seeds over workers. */
export async function simulateProject(project: Project, options: SimOptions): Promise<GameRecord[]> {
  const registry = new PackageRegistry();
  const loaded = await registry.loadFiles(fileSource(projectFiles(project)));
  if (!loaded.ok) throw new Error(loaded.issues.map((i) => `${i.file ?? ''}${i.pointer}: ${i.message}`).join('\n'));
  const resolved = registry.resolve(loaded.package.manifest.id);
  if (!resolved.ok) throw new Error(resolved.issues.map((i) => `${i.file ?? ''}${i.pointer}: ${i.message}`).join('\n'));
  return simulate(resolved.game, options);
}
