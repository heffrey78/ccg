/** Small controls the generated forms are made of. Text and number fields commit on Enter or blur, so each edit is one undo step. */
import { useEffect, useState, type ReactNode } from 'react';

export function TextInput({ value, onCommit, label, placeholder, list }: { value: string; onCommit(v: string): void; label: string; placeholder?: string; list?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => draft !== value && onCommit(draft);
  return (
    <input
      aria-label={label}
      value={draft}
      placeholder={placeholder}
      list={list}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setDraft(value);
      }}
    />
  );
}

export function NumberInput({ value, onCommit, label, min, max, integer }: { value: number; onCommit(v: number): void; label: string; min?: number | undefined; max?: number | undefined; integer: boolean }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(n)) return setDraft(String(value));
    if (n !== value) onCommit(integer ? Math.round(n) : n);
  };
  return (
    <input
      type="number"
      aria-label={label}
      value={draft}
      min={min}
      max={max}
      step={integer ? 1 : 'any'}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
}

/** A labelled row with its validation messages, addressable by JSON Pointer for jump-to-field. */
export function Row({
  label,
  pointer,
  errors,
  warnings = [],
  flagged,
  actions,
  children,
  block,
  help,
}: {
  label: string;
  pointer: string;
  errors: string[];
  warnings?: string[] | undefined;
  flagged: boolean;
  actions?: ReactNode;
  children: ReactNode;
  block?: boolean;
  help?: string | undefined;
}) {
  return (
    <div className={['ccg-form-row', block && 'is-block', errors.length > 0 ? 'has-error' : warnings.length > 0 && 'has-warning', flagged && 'is-flagged'].filter(Boolean).join(' ')} data-pointer={pointer}>
      <div className="ccg-form-label">
        <span>{label}</span>
        {actions}
      </div>
      <div className="ccg-form-control">
        {children}
        {help && <p className="ccg-muted ccg-form-help">{help}</p>}
        {errors.map((e, i) => (
          <p key={i} className="ccg-error">
            {e}
          </p>
        ))}
        {warnings.map((w, i) => (
          <p key={`w${i}`} className="ccg-warning">
            {w}
          </p>
        ))}
      </div>
    </div>
  );
}

/** Words shown in capitals in labels. */
const ACRONYMS: Record<string, string> = { hp: 'HP', id: 'ID', ai: 'AI', js: 'JS', url: 'URL' };

/** "maxHp" → "Max HP", "onEnter" → "On enter" */
export function humanize(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').toLowerCase();
  const out = words
    .split(' ')
    .map((w) => ACRONYMS[w] ?? w)
    .join(' ');
  return out.charAt(0).toUpperCase() + out.slice(1);
}
