/**
 * The behaviour editor (#44): an enemy's decision tree as nested, labelled
 * nodes. Intents use the generated forms (effect composer, pattern picker),
 * conditions use their schema, and switching a node's kind keeps what it held.
 */
import { useState } from 'react';
import type { Behavior } from '@ccg/core';
import { behaviorSummary } from '../../behavior.js';
import { describe, deref, type JsonSchema } from '../../forms/schema.js';
import { NumberInput } from './inputs.js';
import { childPointer, SchemaField, useForm } from './SchemaField.js';

const KINDS = ['intent', 'sequence', 'weighted', 'if'] as const;
type Kind = (typeof KINDS)[number];
const LABELS: Record<Kind, string> = { intent: 'Intent', sequence: 'Sequence', weighted: 'Random', if: 'Condition' };

const NEW_INTENT: Behavior = { kind: 'intent', intent: { name: 'New intent', target: { kind: 'self' }, effects: [] } };

/** The node's first intent, to keep when switching kinds. */
function firstIntent(node: Behavior): Behavior {
  switch (node.kind) {
    case 'intent':
      return node;
    case 'sequence':
      return node.steps[0] ? firstIntent(node.steps[0]) : NEW_INTENT;
    case 'weighted':
      return node.options[0] ? firstIntent(node.options[0].then) : NEW_INTENT;
    case 'if':
      return firstIntent(node.then);
  }
}

function convert(node: Behavior, kind: Kind): Behavior {
  if (node.kind === kind) return node;
  switch (kind) {
    case 'intent':
      return firstIntent(node);
    case 'sequence':
      return { kind: 'sequence', steps: [node] };
    case 'weighted':
      return { kind: 'weighted', options: [{ weight: 1, then: node }] };
    case 'if':
      return { kind: 'if', cond: { kind: 'enemyWithin', range: 1 }, then: node, else: firstIntent(node) };
  }
}

/** The schema option for a behaviour kind, to find its fields' schemas. */
function option(node: JsonSchema, root: JsonSchema, kind: Kind): JsonSchema {
  const spec = describe(node, root);
  if (spec.kind !== 'union') return {};
  return spec.options[spec.labels.indexOf(kind)] ?? {};
}

const prop = (node: JsonSchema, root: JsonSchema, key: string): JsonSchema => deref(node, root).properties?.[key] ?? {};

export function BehaviorEditor({ node, root, value, onChange, pointer, depth = 0 }: { node: JsonSchema; root: JsonSchema; value: Behavior; onChange(v: Behavior): void; pointer: string; depth?: number }) {
  const { issues, flagged } = useForm();
  const [open, setOpen] = useState(depth < 3);
  const errors = issues.get(pointer) ?? [];
  const opt = option(node, root, value.kind);
  const child = (key: string) => prop(opt, root, key);

  return (
    <div className={['ccg-behavior', `is-${value.kind}`, errors.length > 0 && 'has-error', flagged === pointer && 'is-flagged'].filter(Boolean).join(' ')} data-pointer={pointer}>
      <div className="ccg-behavior-head">
        <button type="button" className="ccg-behavior-toggle" aria-expanded={open} aria-label={open ? 'Collapse' : 'Expand'} onClick={() => setOpen((o) => !o)}>
          {open ? '▾' : '▸'}
        </button>
        <select aria-label="Node kind" value={value.kind} onChange={(e) => onChange(convert(value, e.target.value as Kind))}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {LABELS[k]}
            </option>
          ))}
        </select>
        <span className="ccg-behavior-summary">{behaviorSummary(value)}</span>
      </div>
      {errors.map((e, i) => (
        <p key={i} className="ccg-error">
          {e}
        </p>
      ))}
      {open && (
        <div className="ccg-behavior-body">
          {value.kind === 'intent' && (
            <SchemaField node={child('intent')} root={root} value={value.intent} onChange={(intent) => onChange({ ...value, intent: intent as never })} pointer={childPointer(pointer, 'intent')} label="Intent" />
          )}
          {value.kind === 'sequence' && (
            <ChildList
              label="Step"
              items={value.steps}
              node={deref(child('steps'), root).items ?? {}}
              root={root}
              pointer={childPointer(pointer, 'steps')}
              depth={depth}
              onChange={(steps) => onChange({ ...value, steps })}
              add={() => NEW_INTENT}
            />
          )}
          {value.kind === 'weighted' && (
            <div className="ccg-behavior-children">
              {value.options.map((o, i) => (
                <div key={i} className="ccg-behavior-child">
                  <div className="ccg-row">
                    <label>
                      Weight{' '}
                      <NumberInput
                        label={`Weight ${i + 1}`}
                        value={o.weight}
                        min={0}
                        integer={false}
                        onCommit={(weight) => onChange({ ...value, options: value.options.map((x, j) => (j === i ? { ...x, weight } : x)) })}
                      />
                    </label>
                    <button type="button" aria-label={`Remove option ${i + 1}`} disabled={value.options.length <= 1} onClick={() => onChange({ ...value, options: value.options.filter((_, j) => j !== i) })}>
                      ×
                    </button>
                  </div>
                  <BehaviorEditor
                    node={prop(deref(child('options'), root).items ?? {}, root, 'then')}
                    root={root}
                    value={o.then}
                    onChange={(then) => onChange({ ...value, options: value.options.map((x, j) => (j === i ? { ...x, then } : x)) })}
                    pointer={childPointer(childPointer(childPointer(pointer, 'options'), i), 'then')}
                    depth={depth + 1}
                  />
                </div>
              ))}
              <button type="button" className="ccg-form-add" onClick={() => onChange({ ...value, options: [...value.options, { weight: 1, then: NEW_INTENT }] })}>
                + Add option
              </button>
            </div>
          )}
          {value.kind === 'if' && (
            <div className="ccg-behavior-children">
              <SchemaField node={child('cond')} root={root} value={value.cond} onChange={(cond) => onChange({ ...value, cond: cond as never })} pointer={childPointer(pointer, 'cond')} label="If" />
              <div className="ccg-behavior-child">
                <strong>Then</strong>
                <BehaviorEditor node={child('then')} root={root} value={value.then} onChange={(then) => onChange({ ...value, then })} pointer={childPointer(pointer, 'then')} depth={depth + 1} />
              </div>
              <div className="ccg-behavior-child">
                <strong>Otherwise</strong>
                <BehaviorEditor node={child('else')} root={root} value={value.else} onChange={(otherwise) => onChange({ ...value, else: otherwise })} pointer={childPointer(pointer, 'else')} depth={depth + 1} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChildList({
  label,
  items,
  node,
  root,
  pointer,
  depth,
  onChange,
  add,
}: {
  label: string;
  items: Behavior[];
  node: JsonSchema;
  root: JsonSchema;
  pointer: string;
  depth: number;
  onChange(items: Behavior[]): void;
  add(): Behavior;
}) {
  const move = (from: number, to: number) => {
    const out = [...items];
    const [x] = out.splice(from, 1);
    out.splice(to, 0, x as Behavior);
    onChange(out);
  };
  return (
    <ol className="ccg-behavior-children">
      {items.map((item, i) => (
        <li key={i} className="ccg-behavior-child">
          <div className="ccg-row">
            <strong>
              {label} {i + 1}
            </strong>
            <span className="ccg-spacer" />
            <button type="button" aria-label={`Move ${label.toLowerCase()} ${i + 1} up`} disabled={i === 0} onClick={() => move(i, i - 1)}>
              ↑
            </button>
            <button type="button" aria-label={`Remove ${label.toLowerCase()} ${i + 1}`} disabled={items.length <= 1} onClick={() => onChange(items.filter((_, j) => j !== i))}>
              ×
            </button>
          </div>
          <BehaviorEditor node={node} root={root} value={item} onChange={(v) => onChange(items.map((x, j) => (j === i ? v : x)))} pointer={childPointer(pointer, i)} depth={depth + 1} />
        </li>
      ))}
      <li>
        <button type="button" className="ccg-form-add" onClick={() => onChange([...items, add()])}>
          + Add {label.toLowerCase()}
        </button>
      </li>
    </ol>
  );
}
