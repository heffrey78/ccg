import { describe, expect, it } from 'vitest';
import { createPlatform } from './index.js';
import type { Invoke } from './desktop.js';

describe('the platform adapters (#141)', () => {
  it('on desktop, storage and settings go through the shell commands', async () => {
    const calls: [string, Record<string, unknown> | undefined][] = [];
    const data = new Map<string, string>();
    const invoke: Invoke = async <T,>(command: string, args?: Record<string, unknown>) => {
      calls.push([command, args]);
      const key = args?.key as string;
      if (command === 'kv_set') data.set(key, args?.value as string);
      if (command === 'kv_delete') data.delete(key);
      if (command === 'kv_get') return (data.get(key) ?? null) as T;
      if (command === 'kv_keys') return [...data.keys()].filter((k) => k.startsWith(args?.prefix as string)).sort() as T;
      return undefined as T;
    };
    const platform = createPlatform({ desktop: true, invoke: Promise.resolve(invoke) });
    await platform.settings.set('animationSpeed', 2);
    expect(await platform.settings.get('animationSpeed', 1)).toBe(2);
    expect(await platform.storage.keys('settings:')).toEqual(['settings:animationSpeed']);
    await platform.storage.delete('settings:animationSpeed');
    expect(await platform.storage.get('settings:animationSpeed')).toBeNull();
    expect(calls.map(([c]) => c)).toEqual(['kv_set', 'kv_get', 'kv_keys', 'kv_delete', 'kv_get']);
    expect(platform.setFullscreen).toBeTypeOf('function');
  });

  it('in a browser without IndexedDB it falls back to memory, with no native full screen', async () => {
    const platform = createPlatform({ desktop: false });
    await platform.storage.set('a', '1');
    expect(await platform.storage.get('a')).toBe('1');
    expect(platform.setFullscreen).toBeUndefined();
  });
});
