// Writes JSON Schema for game.json and content files, built from the engine's
// built-in ops, to dist/schema/ for external editors and IDEs (#38, #24).
import { mkdirSync, writeFileSync } from 'node:fs';
import { createContentSchemas, exportJsonSchemas, serialize } from '@ccg/content';
import { builtinOps } from '../dist/index.js';

const out = new URL('../dist/schema/', import.meta.url);
mkdirSync(out, { recursive: true });
const schemas = exportJsonSchemas(createContentSchemas(builtinOps()));
writeFileSync(new URL('manifest.schema.json', out), serialize(schemas.manifest));
writeFileSync(new URL('item.schema.json', out), serialize(schemas.item));
