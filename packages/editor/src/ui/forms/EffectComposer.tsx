/**
 * The effect composer (#40): an ordered list of effects, each with a form
 * generated from its op's metadata, added from a searchable palette of every
 * op the project can use (built-in and package ops alike). Any parameter can
 * be switched to a variable, e.g. `target` or `event.unit`.
 */
import { useState } from 'react';
import { renderText, type ContentKind, type OpMeta } from '@ccg/content';
import { itemsOfKind, type Project } from '../../project.js';
import { defaultEffect, defaultValue, describe, opParamsSchema, palette } from '../../forms/schema.js';
import { humanize, TextInput } from './inputs.js';
import { childPointer, SchemaField, useForm } from './SchemaField.js';

type Effect = Record<string, unknown>;

/** Variables most effects can read; the field also accepts any other name. */
const COMMON_VARS = ['target', 'self', 'source', 'holder', 'stacks', 'event.unit', 'event.amount', 'dir', 'found.count', 'spawned.unit'];

/** Content kinds an op parameter references, by widget hint. */
const REF_KINDS: Record<string, ContentKind> = { status: 'status', cardDef: 'card', unitDef: 'unit' };

/** Fills required reference parameters with the project's first item of that kind, so a new effect starts valid. */
function withProjectRefs(effect: Effect, meta: OpMeta, project: Project): Effect {
  const out = { ...effect };
  for (const [key, hint] of Object.entries(meta.widgets ?? {})) {
    const kind = REF_KINDS[hint];
    if (kind && key in out && typeof out[key] === 'string') {
      const first = itemsOfKind(project, kind)[0];
      if (first) out[key] = first[1].id;
    }
  }
  return out;
}

export function EffectList({ value, onChange, pointer }: { value: Effect[]; onChange(v: Effect[]): void; pointer: string }) {
  const { project } = useForm();
  const [adding, setAdding] = useState(false);
  const move = (from: number, to: number) => {
    const out = [...value];
    const [x] = out.splice(from, 1);
    out.splice(to, 0, x as Effect);
    onChange(out);
  };
  return (
    <div className="ccg-effects">
      {value.length === 0 && <p className="ccg-muted">No effects.</p>}
      <ol>
        {value.map((effect, i) => (
          <li key={i}>
            <EffectRow
              effect={effect}
              pointer={childPointer(pointer, i)}
              onChange={(e) => onChange(value.map((x, j) => (j === i ? e : x)))}
              onRemove={() => onChange(value.filter((_, j) => j !== i))}
              {...(i > 0 && { onUp: () => move(i, i - 1) })}
              {...(i < value.length - 1 && { onDown: () => move(i, i + 1) })}
            />
          </li>
        ))}
      </ol>
      {adding ? (
        <Palette
          onPick={(meta) => {
            onChange([...value, withProjectRefs(defaultEffect(meta), meta, project)]);
            setAdding(false);
          }}
          onClose={() => setAdding(false)}
        />
      ) : (
        <button type="button" className="ccg-form-add" onClick={() => setAdding(true)}>
          + Add effect
        </button>
      )}
    </div>
  );
}

function Palette({ onPick, onClose }: { onPick(meta: OpMeta): void; onClose(): void }) {
  const { ops } = useForm();
  const [query, setQuery] = useState('');
  const groups = palette(ops.list(), query);
  return (
    <div className="ccg-palette" role="dialog" aria-label="Add effect">
      <div className="ccg-row">
        <input
          type="search"
          autoFocus
          aria-label="Search effects"
          placeholder="Search effects"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            const first = groups[0]?.ops[0];
            if (e.key === 'Enter' && first) onPick(first);
          }}
        />
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
      <div className="ccg-palette-groups">
        {groups.map((g) => (
          <section key={g.category}>
            <h4>{humanize(g.category)}</h4>
            {g.ops.map((op) => (
              <button key={op.id} type="button" title={op.description} onClick={() => onPick(op)}>
                {op.displayName}
                {op.id.includes(':') && <span className="ccg-muted"> {op.id.slice(0, op.id.indexOf(':'))}</span>}
              </button>
            ))}
          </section>
        ))}
        {groups.length === 0 && <p className="ccg-muted">No effect matches.</p>}
      </div>
    </div>
  );
}

const isVar = (v: unknown): v is { $: string } => typeof v === 'object' && v !== null && '$' in v;

function EffectRow({ effect, pointer, onChange, onRemove, onUp, onDown }: { effect: Effect; pointer: string; onChange(e: Effect): void; onRemove(): void; onUp?: () => void; onDown?: () => void }) {
  const { ops, issues, flagged } = useForm();
  const meta = ops.get(effect.op as string);
  const errors = issues.get(pointer) ?? [];
  const header = (
    <div className="ccg-effect-head">
      <strong>{meta?.displayName ?? String(effect.op)}</strong>
      {meta && <span className="ccg-muted ccg-effect-text">{renderText(meta, effect)}</span>}
      <span className="ccg-spacer" />
      <button type="button" aria-label="Move effect up" disabled={!onUp} onClick={onUp}>
        ↑
      </button>
      <button type="button" aria-label="Move effect down" disabled={!onDown} onClick={onDown}>
        ↓
      </button>
      <button type="button" aria-label={`Remove ${meta?.displayName ?? 'effect'}`} onClick={onRemove}>
        ×
      </button>
    </div>
  );
  if (!meta) {
    return (
      <div className="ccg-effect has-error" data-pointer={pointer}>
        {header}
        <p className="ccg-error">Unknown op '{String(effect.op)}'. Remove it, or add the package that defines it.</p>
      </div>
    );
  }
  const root = opParamsSchema(meta);
  const spec = describe(root, root);
  const fields = spec.kind === 'object' ? spec.fields : [];
  const set = (key: string, v: unknown) => {
    if (v === undefined) {
      const { [key]: _gone, ...rest } = effect;
      onChange(rest);
    } else onChange({ ...effect, [key]: v });
  };

  return (
    <div className={['ccg-effect', errors.length > 0 && 'has-error', flagged === pointer && 'is-flagged'].filter(Boolean).join(' ')} data-pointer={pointer} aria-label={meta.displayName}>
      {header}
      {errors.map((e, i) => (
        <p key={i} className="ccg-error">
          {e}
        </p>
      ))}
      <div className="ccg-form-object">
        {fields.map((f) => {
          const value = effect[f.key];
          const hint = meta.widgets?.[f.key];
          const label = humanize(f.key);
          const fieldPointer = childPointer(pointer, f.key);
          if (value === undefined && !f.required) return null;
          const varToggle =
            hint === 'effects' ? null : (
              <button
                type="button"
                className="ccg-var-toggle"
                aria-pressed={isVar(value)}
                aria-label={`${label}: use a variable`}
                title="Use a variable instead of a value"
                onClick={() => set(f.key, isVar(value) ? defaultValue(f.node, root) : { $: 'target' })}
              >
                {'{x}'}
              </button>
            );
          const remove = !f.required && (
            <button type="button" className="ccg-form-remove" aria-label={`Remove ${label}`} onClick={() => set(f.key, undefined)}>
              ×
            </button>
          );
          const actions = (
            <span className="ccg-form-actions">
              {varToggle}
              {remove}
            </span>
          );
          if (isVar(value)) {
            return <VariableField key={f.key} label={label} pointer={fieldPointer} value={value.$} onChange={(name) => set(f.key, { $: name })} actions={actions} />;
          }
          return <SchemaField key={f.key} node={f.node} root={root} value={value} onChange={(v) => set(f.key, v)} pointer={fieldPointer} label={label} hint={hint ?? 'none'} actions={actions} />;
        })}
        <OptionalParams fields={fields.filter((f) => !f.required && effect[f.key] === undefined)} onAdd={(key, node) => set(key, meta.widgets?.[key] === 'effects' ? [] : defaultValue(node, root))} />
      </div>
    </div>
  );
}

function OptionalParams({ fields, onAdd }: { fields: { key: string; node: object }[]; onAdd(key: string, node: object): void }) {
  if (fields.length === 0) return null;
  return (
    <div className="ccg-form-optional">
      {fields.map((f) => (
        <button key={f.key} type="button" className="ccg-form-add" onClick={() => onAdd(f.key, f.node)}>
          + {humanize(f.key)}
        </button>
      ))}
    </div>
  );
}

function VariableField({ label, pointer, value, onChange, actions }: { label: string; pointer: string; value: string; onChange(name: string): void; actions: React.ReactNode }) {
  const { issues, flagged } = useForm();
  const errors = issues.get(pointer) ?? [];
  const list = `vars-${pointer}`;
  return (
    <div className={['ccg-form-row', errors.length > 0 && 'has-error', flagged === pointer && 'is-flagged'].filter(Boolean).join(' ')} data-pointer={pointer}>
      <div className="ccg-form-label">
        <span>{label}</span>
        {actions}
      </div>
      <div className="ccg-form-control">
        <TextInput label={`${label} variable`} list={list} value={value} onCommit={(name) => name.trim() && onChange(name.trim())} />
        <datalist id={list}>
          {COMMON_VARS.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
        {errors.map((e, i) => (
          <p key={i} className="ccg-error">
            {e}
          </p>
        ))}
      </div>
    </div>
  );
}
