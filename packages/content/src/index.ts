import { z } from 'zod';
import type { ContentSchemas } from './schemas.js';

export { FORMAT_VERSION, parseJson, serialize, type ParseResult } from './format.js';
export { ID_PATTERN, OP_ID_PATTERN, REF_PATTERN, parseRef, type Ref } from './ids.js';
export { Migrator, migrator, type MigrateResult, type Migration } from './migrate.js';
export { OpRegistry, effectSchemaFor, renderText, varRef, type OpMeta, type WidgetHint } from './ops.js';
export {
  MANIFEST_PATH,
  loadPackage,
  memorySource,
  serializeItem,
  toPointer,
  type ContentIssue,
  type FileSource,
  type LoadedItem,
  type LoadedPackage,
} from './package.js';
export {
  CONTENT_KINDS,
  createContentSchemas,
  patternShape,
  targeting,
  type ContentItem,
  type ContentKind,
  type ContentSchemas,
  type Manifest,
  type PatternShapeData,
  type SchemaOptions,
  type Targeting,
} from './schemas.js';

/** JSON Schema (draft 2020-12) for the manifest and content items, for external editors and IDEs. */
export function exportJsonSchemas(schemas: ContentSchemas): { manifest: object; item: object } {
  return {
    manifest: z.toJSONSchema(schemas.manifest),
    item: z.toJSONSchema(schemas.item),
  };
}
