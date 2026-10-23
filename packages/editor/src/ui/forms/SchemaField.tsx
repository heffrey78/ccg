/**
 * The generated form (#40): draws any JSON Schema node, choosing the control
 * from widget hints first and the schema second. Optional fields that are
 * absent stay absent (an "add" button puts them in), so saved content keeps
 * only what the author set.
 */
import { createContext, useContext, useState } from 'react';
import type { ContentKind, OpRegistry, WidgetHint } from '@ccg/content';
import type { Project } from '../../project.js';
import { itemsOfKind } from '../../project.js';
import { defaultValue, describe, itemHint, matchOption, type JsonSchema } from '../../forms/schema.js';
import type { PreviewBoard } from '../../forms/patterns.js';
import { AssetPreview } from '../AssetPanel.js';
import { CostEditor } from './CostEditor.js';
import { EffectList } from './EffectComposer.js';
import { humanize, NumberInput, Row, TextInput } from './inputs.js';
import { PatternPicker } from './PatternPicker.js';

export interface FormContext {
  project: Project;
  ops: OpRegistry;
  /** The item being edited, for item-specific hints. */
  kind: ContentKind;
  board: PreviewBoard;
  setBoard(board: PreviewBoard): void;
  /** Validation messages by JSON Pointer. */
  issues: Map<string, string[]>;
  /** The pointer to highlight (jump-to-field). */
  flagged?: string | undefined;
}

export const Form = createContext<FormContext | null>(null);

export function useForm(): FormContext {
  const ctx = useContext(Form);
  if (!ctx) throw new Error('form controls need a Form context');
  return ctx;
}

const escape = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');
export const childPointer = (pointer: string, key: string | number) => `${pointer}/${escape(String(key))}`;

/** Content kinds referenced by each hint. */
const REF_HINTS: Partial<Record<WidgetHint, ContentKind>> = { status: 'status', cardDef: 'card', unitDef: 'unit', tileDef: 'tile' };

export interface FieldProps {
  node: JsonSchema;
  root: JsonSchema;
  value: unknown;
  onChange(value: unknown): void;
  pointer: string;
  label: string;
  /** Overrides the item-level hint for this pointer (op parameters pass theirs). */
  hint?: WidgetHint | undefined;
  /** Shown next to the label, e.g. remove or variable toggles. */
  actions?: React.ReactNode;
}

export function SchemaField({ node, root, value, onChange, pointer, label, hint: given, actions }: FieldProps) {
  const ctx = useForm();
  const hint = given ?? itemHint(ctx.kind, pointer);
  const errors = ctx.issues.get(pointer) ?? [];
  const flagged = ctx.flagged === pointer;
  const row = (control: React.ReactNode, block = false) => (
    <Row label={label} pointer={pointer} errors={errors} flagged={flagged} actions={actions} block={block}>
      {control}
    </Row>
  );

  // ---- hinted controls ----
  if (hint === 'effects' && (Array.isArray(value) || value === undefined)) {
    return row(<EffectList value={(value as Record<string, unknown>[] | undefined) ?? []} onChange={onChange} pointer={pointer} />, true);
  }
  if (hint === 'cost' && (typeof value === 'object' || value === undefined)) {
    return row(<CostEditor value={(value as Record<string, number> | undefined) ?? {}} onChange={onChange} label={label} />);
  }
  if (hint === 'pattern' && typeof value === 'object' && value !== null) {
    return row(<PatternPicker value={value as never} onChange={onChange} label={label} />, true);
  }
  const refKind = hint ? REF_HINTS[hint] : undefined;
  if (refKind && (typeof value === 'string' || value === undefined)) {
    const options = itemsOfKind(ctx.project, refKind);
    const current = typeof value === 'string' ? value : '';
    return row(
      <select aria-label={label} value={current} onChange={(e) => onChange(e.target.value)}>
        {!options.some(([, i]) => i.id === current) && <option value={current}>{current || '— choose —'}</option>}
        {options.map(([key, item]) => (
          <option key={key} value={item.id}>
            {item.name} ({item.id})
          </option>
        ))}
      </select>,
    );
  }
  if (hint === 'asset' && (typeof value === 'string' || value === undefined)) {
    const current = (value as string | undefined) ?? '';
    const assets = Object.keys(ctx.project.assets).sort();
    return row(
      <span className="ccg-row">
        {current && <AssetPreview project={ctx.project} path={current} size={40} />}
        <select aria-label={label} value={current} onChange={(e) => onChange(e.target.value)}>
          {!assets.includes(current) && <option value={current}>{current ? `${current} (missing)` : '— choose a file —'}</option>}
          {assets.map((a) => (
            <option key={a} value={a}>
              {a.slice('assets/'.length)}
            </option>
          ))}
        </select>
      </span>,
    );
  }

  // ---- by schema ----
  const spec = describe(node, root);
  switch (spec.kind) {
    case 'const':
      return null;
    case 'string':
      return row(<TextInput label={label} value={typeof value === 'string' ? value : ''} onCommit={onChange} />);
    case 'number':
      return row(<NumberInput label={label} value={typeof value === 'number' ? value : 0} onCommit={onChange} min={spec.min} max={spec.max} integer={spec.integer} />);
    case 'boolean':
      return row(<input type="checkbox" aria-label={label} checked={value === true} onChange={(e) => onChange(e.target.checked)} />);
    case 'enum':
      return row(
        <select aria-label={label} value={String(value ?? '')} onChange={(e) => onChange(spec.options.find((o) => String(o) === e.target.value))}>
          {value === undefined && <option value="">— choose —</option>}
          {spec.options.map((o) => (
            <option key={String(o)} value={String(o)}>
              {String(o)}
            </option>
          ))}
        </select>,
      );
    case 'object':
      return row(<ObjectFields fields={spec.fields} root={root} value={(value as Record<string, unknown>) ?? {}} onChange={onChange} pointer={pointer} />, true);
    case 'record':
      return row(<RecordFields valueNode={spec.value} root={root} value={(value as Record<string, unknown>) ?? {}} onChange={onChange} pointer={pointer} label={label} />, true);
    case 'array': {
      const list = Array.isArray(value) ? value : [];
      return row(
        <div className="ccg-form-list">
          {list.map((item, i) => (
            <SchemaField
              key={i}
              node={spec.item}
              root={root}
              value={item}
              onChange={(v) => onChange(list.map((x, j) => (j === i ? v : x)))}
              pointer={childPointer(pointer, i)}
              label={`${label} ${i + 1}`}
              actions={
                <span className="ccg-form-actions">
                  <button type="button" aria-label={`Move ${label} ${i + 1} up`} disabled={i === 0} onClick={() => onChange(swap(list, i, i - 1))}>
                    ↑
                  </button>
                  <button type="button" aria-label={`Remove ${label} ${i + 1}`} disabled={list.length <= spec.minItems} onClick={() => onChange(list.filter((_, j) => j !== i))}>
                    ×
                  </button>
                </span>
              }
            />
          ))}
          <button type="button" className="ccg-form-add" onClick={() => onChange([...list, defaultValue(spec.item, root)])}>
            + Add {label.toLowerCase()}
          </button>
        </div>,
        true,
      );
    }
    case 'union': {
      const index = matchOption(spec, value, root);
      const option = spec.options[index] as JsonSchema;
      const optionSpec = describe(option, root);
      return row(
        <div className="ccg-form-union">
          <select
            aria-label={`${label} kind`}
            value={index}
            onChange={(e) => onChange(defaultValue(spec.options[Number(e.target.value)] as JsonSchema, root))}
          >
            {spec.labels.map((l, i) => (
              <option key={i} value={i}>
                {l}
              </option>
            ))}
          </select>
          {optionSpec.kind === 'object' ? (
            <ObjectFields fields={optionSpec.fields} root={root} value={(value as Record<string, unknown>) ?? {}} onChange={onChange} pointer={pointer} />
          ) : (
            <SchemaField node={option} root={root} value={value} onChange={onChange} pointer={pointer} label={label} />
          )}
        </div>,
        optionSpec.kind === 'object',
      );
    }
    case 'unknown':
      return row(<JsonInput label={label} value={value} onChange={onChange} />);
  }
}

function swap<T>(list: T[], a: number, b: number): T[] {
  const out = [...list];
  [out[a], out[b]] = [out[b] as T, out[a] as T];
  return out;
}

/** An object's fields: required ones always, optional ones once added. */
export function ObjectFields({
  fields,
  root,
  value,
  onChange,
  pointer,
  skip = [],
}: {
  fields: { key: string; node: JsonSchema; required: boolean }[];
  root: JsonSchema;
  value: Record<string, unknown>;
  onChange(value: Record<string, unknown>): void;
  pointer: string;
  skip?: string[];
}) {
  const shown = fields.filter((f) => !skip.includes(f.key) && describe(f.node, root).kind !== 'const');
  const absent = shown.filter((f) => !f.required && value[f.key] === undefined);
  const set = (key: string, v: unknown) => onChange({ ...value, [key]: v });
  const remove = (key: string) => {
    const { [key]: _gone, ...rest } = value;
    onChange(rest);
  };
  return (
    <div className="ccg-form-object">
      {shown
        .filter((f) => f.required || value[f.key] !== undefined)
        .map((f) => (
          <SchemaField
            key={f.key}
            node={f.node}
            root={root}
            value={value[f.key]}
            onChange={(v) => set(f.key, v)}
            pointer={childPointer(pointer, f.key)}
            label={humanize(f.key)}
            {...(!f.required && {
              actions: (
                <button type="button" className="ccg-form-remove" aria-label={`Remove ${humanize(f.key)}`} onClick={() => remove(f.key)}>
                  ×
                </button>
              ),
            })}
          />
        ))}
      {absent.length > 0 && (
        <div className="ccg-form-optional">
          {absent.map((f) => (
            <button key={f.key} type="button" className="ccg-form-add" onClick={() => set(f.key, defaultValue(f.node, root))}>
              + {humanize(f.key)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RecordFields({ valueNode, root, value, onChange, pointer, label }: { valueNode: JsonSchema; root: JsonSchema; value: Record<string, unknown>; onChange(v: unknown): void; pointer: string; label: string }) {
  const [key, setKey] = useState('');
  return (
    <div className="ccg-form-object">
      {Object.entries(value).map(([k, v]) => (
        <SchemaField
          key={k}
          node={valueNode}
          root={root}
          value={v}
          onChange={(next) => onChange({ ...value, [k]: next })}
          pointer={childPointer(pointer, k)}
          label={k}
          actions={
            <button
              type="button"
              className="ccg-form-remove"
              aria-label={`Remove ${k}`}
              onClick={() => {
                const { [k]: _gone, ...rest } = value;
                onChange(rest);
              }}
            >
              ×
            </button>
          }
        />
      ))}
      <div className="ccg-row">
        <input aria-label={`New ${label} key`} placeholder="key" value={key} onChange={(e) => setKey(e.target.value)} />
        <button
          type="button"
          className="ccg-form-add"
          disabled={key.trim() === '' || key in value}
          onClick={() => {
            onChange({ ...value, [key.trim()]: defaultValue(valueNode, root) });
            setKey('');
          }}
        >
          + Add
        </button>
      </div>
    </div>
  );
}

/** Raw JSON for values the form has no control for. */
function JsonInput({ label, value, onChange }: { label: string; value: unknown; onChange(v: unknown): void }) {
  const [draft, setDraft] = useState(JSON.stringify(value ?? null));
  const [bad, setBad] = useState(false);
  return (
    <textarea
      aria-label={label}
      className={bad ? 'has-error' : undefined}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        try {
          onChange(JSON.parse(draft));
          setBad(false);
        } catch {
          setBad(true);
        }
      }}
    />
  );
}
