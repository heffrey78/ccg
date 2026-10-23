/**
 * An item's form (#40, #43): its kind's schema split into sections, with a
 * live preview drawn by the play client's own renderer for cards and a chip
 * for statuses. Header fields (name, id, tags) belong to the item panel.
 */
import { useMemo } from 'react';
import { createContentSchemas, type ContentItem, type ContentKind, type OpRegistry } from '@ccg/content';
import { CardPreview } from '@ccg/client';
import { cardFace } from '@ccg/client/engine';
import { describe, jsonSchemaOf } from '../../forms/schema.js';
import type { PreviewBoard } from '../../forms/patterns.js';
import type { Project } from '../../project.js';
import type { ProjectIssue } from '../../validate.js';
import { AssetPreview, useAssetUrl } from '../AssetPanel.js';
import { Form, ObjectFields, type FormContext } from './SchemaField.js';

const HEADER_FIELDS = ['formatVersion', 'kind', 'id', 'name', 'tags', 'extensions'];

/** Sections per kind; fields not listed fall into "More". */
const SECTIONS: Partial<Record<ContentKind, [string, string[]][]>> = {
  card: [
    ['Play', ['cost', 'targeting', 'timing', 'reaction', 'faceDown', 'exhausts']],
    ['Effects', ['effects']],
    ['Card face', ['rarity', 'keywords', 'text', 'art']],
    ['Permanent', ['permanent']],
    ['Upgrade', ['upgrade']],
  ],
  status: [
    ['Rules', ['stacking', 'hooks', 'modifiers']],
    ['Display', ['description', 'icon']],
  ],
};

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

/** A content reference's display name, from the project (unqualified ids) by trying each kind. */
export function nameIn(project: Project) {
  return (ref: string) => {
    const id = ref.includes(':') && ref.startsWith(`${project.manifest.id}:`) ? ref.slice(project.manifest.id.length + 1) : ref;
    for (const kind of ['status', 'card', 'unit', 'tile', 'encounter'] as const) {
      const item = project.items[`${kind}:${id}`];
      if (item) return item.name;
    }
    return undefined;
  };
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
  if (spec.kind !== 'object') return null;

  const sections = SECTIONS[item.kind];
  const listed = new Set(sections?.flatMap(([, keys]) => keys) ?? []);
  const rest = spec.fields.map((f) => f.key).filter((k) => !listed.has(k) && !HEADER_FIELDS.includes(k));
  const groups: [string, string[]][] = sections ? [...sections, ...(rest.length > 0 ? [['More', rest] as [string, string[]]] : [])] : [['', rest]];
  const value = item as unknown as Record<string, unknown>;
  const change = (v: Record<string, unknown>) => onChange(v as unknown as ContentItem);

  return (
    <Form.Provider value={ctx}>
      <div className="ccg-item-form">
        <div className="ccg-item-sections">
          {groups.map(([title, keys]) =>
            title ? (
              <fieldset key={title} className="ccg-section">
                <legend>{title}</legend>
                <ObjectFields fields={spec.fields} root={root} value={value} onChange={change} pointer="" only={keys} />
              </fieldset>
            ) : (
              <ObjectFields key="all" fields={spec.fields} root={root} value={value} onChange={change} pointer="" only={keys} />
            ),
          )}
        </div>
        {item.kind === 'card' && <CardPreviewPane project={project} ops={ops} item={item} board={board} />}
        {item.kind === 'status' && <StatusPreview project={project} item={item} />}
      </div>
    </Form.Provider>
  );
}

function CardPreviewPane({ project, ops, item, board }: { project: Project; ops: OpRegistry; item: ContentItem; board: PreviewBoard }) {
  const art = typeof item.art === 'string' ? item.art : '';
  const artUrl = useAssetUrl(project.assets[art], art);
  let face;
  try {
    face = cardFace(item, ops, { topology: board, name: nameIn(project), art: () => artUrl ?? undefined });
  } catch {
    face = null;
  }
  return (
    <aside className="ccg-preview" aria-label="Preview">
      {face ? (
        <>
          <div className="ccg-app ccg-preview-host">
            <CardPreview face={face} />
          </div>
          <p className="ccg-card-preview" aria-label="Card text">
            {face.text || <span className="ccg-muted">No text yet.</span>}
          </p>
          {face.targeting && <p className="ccg-muted">{face.targeting}</p>}
        </>
      ) : (
        <p className="ccg-muted">Fix the card's problems to see its preview.</p>
      )}
    </aside>
  );
}

function StatusPreview({ project, item }: { project: Project; item: ContentItem }) {
  const icon = typeof item.icon === 'string' ? item.icon : null;
  return (
    <aside className="ccg-preview" aria-label="Preview">
      <div className="ccg-status-chip">
        {icon && <AssetPreview project={project} path={icon} size={24} />}
        <strong>{item.name}</strong>
        <span className="ccg-muted">{String(item.stacking)}</span>
      </div>
      {typeof item.description === 'string' && <p>{item.description}</p>}
    </aside>
  );
}
