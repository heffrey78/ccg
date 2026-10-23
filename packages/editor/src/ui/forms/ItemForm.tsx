/** An item's generated form (#40): every field of its kind's schema except the header fields the item panel owns. */
import { useMemo } from 'react';
import { createContentSchemas, type ContentItem, type OpRegistry } from '@ccg/content';
import { cardText, type Effect } from '@ccg/core';
import { describe, jsonSchemaOf } from '../../forms/schema.js';
import type { PreviewBoard } from '../../forms/patterns.js';
import type { Project } from '../../project.js';
import type { ProjectIssue } from '../../validate.js';
import { Form, ObjectFields, type FormContext } from './SchemaField.js';

const HEADER_FIELDS = ['formatVersion', 'kind', 'id', 'name', 'tags', 'extensions'];

export interface ItemFormProps {
  project: Project;
  ops: OpRegistry;
  item: ContentItem;
  issues: ProjectIssue[];
  flagged?: string | undefined;
  board: PreviewBoard;
  setBoard(board: PreviewBoard): void;
  onChange(item: ContentItem): void;
}

export function ItemForm({ project, ops, item, issues, flagged, board, setBoard, onChange }: ItemFormProps) {
  const schemas = useMemo(() => createContentSchemas(ops), [ops]);
  const root = jsonSchemaOf(schemas[item.kind]);
  const spec = describe(root, root);
  const ctx: FormContext = useMemo(() => {
    const byPointer = new Map<string, string[]>();
    for (const i of issues) byPointer.set(i.pointer, [...(byPointer.get(i.pointer) ?? []), i.message]);
    return { project, ops, kind: item.kind, board, setBoard, issues: byPointer, flagged };
  }, [project, ops, item.kind, board, setBoard, issues, flagged]);

  let text: string | null = null;
  if (item.kind === 'card') {
    try {
      text = cardText(item as unknown as { text?: string; effects: Effect[] }, ops, { topology: board, name: (ref) => project.items[`status:${ref}`]?.name ?? project.items[`card:${ref}`]?.name ?? project.items[`unit:${ref}`]?.name });
    } catch {
      text = null;
    }
  }

  return (
    <Form.Provider value={ctx}>
      {text !== null && (
        <p className="ccg-card-preview" aria-label="Card text">
          {text || <span className="ccg-muted">No text yet.</span>}
        </p>
      )}
      {spec.kind === 'object' && (
        <ObjectFields fields={spec.fields} root={root} value={item as unknown as Record<string, unknown>} onChange={(v) => onChange(v as unknown as ContentItem)} pointer="" skip={HEADER_FIELDS} />
      )}
    </Form.Provider>
  );
}
