import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { OpRegistry, createContentSchemas, memorySource, type FileSource } from '../src/index.js';

/** A stand-in for the built-in op library that #24 will register. */
export function sampleOps(): OpRegistry {
  return new OpRegistry()
    .register({
      id: 'damage',
      displayName: 'Damage',
      description: 'Deal damage to the target.',
      params: z.object({ amount: z.number().int().min(0), target: z.string().optional() }),
      text: 'Deal {amount} damage.',
      widgets: { amount: 'number', target: 'unit' },
    })
    .register({
      id: 'push',
      displayName: 'Push',
      description: 'Push the target away.',
      params: z.object({ distance: z.number().int().min(1) }),
      text: 'Push {distance}.',
    })
    .register({
      id: 'draw',
      displayName: 'Draw',
      description: 'Draw cards.',
      params: z.object({ n: z.number().int().min(1) }),
      text: 'Draw {n}.',
    })
    .register({
      id: 'applyStatus',
      displayName: 'Apply status',
      description: 'Give the target a status.',
      params: z.object({ status: z.string(), stacks: z.number().int().min(1) }),
      text: 'Apply {stacks} {status}.',
      widgets: { status: 'status' },
    });
}

export const schemas = createContentSchemas(sampleOps());

export const SAMPLE_DIR = fileURLToPath(new URL('./fixtures/sample', import.meta.url));

/** Every file under a directory, keyed by '/'-separated relative path. */
export function readTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else out[relative(dir, full).split(sep).join('/')] = readFileSync(full, 'utf8');
    }
  };
  walk(dir);
  return out;
}

export function sampleSource(edit?: (files: Record<string, string>) => void): FileSource {
  const files = readTree(SAMPLE_DIR);
  edit?.(files);
  return memorySource(files);
}
