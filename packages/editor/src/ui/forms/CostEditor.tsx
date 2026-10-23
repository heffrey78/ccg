/** Costs across resource pools (#40): one number per resource, pools suggested from the rest of the project. */
import { useMemo, useState } from 'react';
import { NumberInput } from './inputs.js';
import { useForm } from './SchemaField.js';

export function CostEditor({ value, onChange, label }: { value: Record<string, number>; onChange(v: Record<string, number>): void; label: string }) {
  const { project } = useForm();
  const [pool, setPool] = useState('');
  const known = useMemo(() => {
    const pools = new Set<string>(['energy']);
    for (const item of Object.values(project.items)) for (const k of Object.keys((item.cost as Record<string, number> | undefined) ?? {})) pools.add(k);
    return [...pools].sort();
  }, [project]);
  const listId = `pools-${label}`;
  return (
    <div className="ccg-cost">
      {Object.entries(value).map(([r, n]) => (
        <label key={r} className="ccg-cost-pool">
          <span>{r}</span>
          <NumberInput label={`${label}: ${r}`} value={n} min={0} integer onCommit={(v) => onChange({ ...value, [r]: v })} />
          <button
            type="button"
            className="ccg-form-remove"
            aria-label={`Remove ${r} cost`}
            onClick={() => {
              const { [r]: _gone, ...rest } = value;
              onChange(rest);
            }}
          >
            ×
          </button>
        </label>
      ))}
      <span className="ccg-row">
        <input aria-label={`${label}: resource`} placeholder="resource" list={listId} value={pool} onChange={(e) => setPool(e.target.value.trim())} />
        <datalist id={listId}>
          {known.filter((k) => !(k in value)).map((k) => (
            <option key={k} value={k} />
          ))}
        </datalist>
        <button
          type="button"
          className="ccg-form-add"
          disabled={!/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(pool) || pool in value}
          onClick={() => {
            onChange({ ...value, [pool]: 1 });
            setPool('');
          }}
        >
          + Cost
        </button>
      </span>
    </div>
  );
}
