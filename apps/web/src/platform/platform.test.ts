import { describe, expect, it, vi } from 'vitest';
import { createPlatform } from './index.js';
import { isAndroid, isDesktop, type Invoke } from './desktop.js';

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

  it('on Android, storage goes through the shell, only play is offered, and desktop services are absent (#161)', async () => {
    const data = new Map<string, string>();
    const invoke: Invoke = async <T,>(command: string, args?: Record<string, unknown>) => {
      if (command === 'kv_set') data.set(args?.key as string, args?.value as string);
      if (command === 'kv_get') return (data.get(args?.key as string) ?? null) as T;
      return undefined as T;
    };
    const platform = createPlatform({ android: true, invoke: Promise.resolve(invoke) });
    await platform.settings.set('soundVolume', 1);
    expect(await platform.settings.get('soundVolume', 0)).toBe(1);
    expect(platform.playOnly).toBe(true);
    expect(platform.packages).toBeUndefined();
    expect(platform.revealPackages).toBeUndefined();
    expect(platform.setFullscreen).toBeUndefined();
  });

  it('tells the Android app from the desktop app and a browser by the shell and the user agent', () => {
    const inBrowser = isAndroid();
    expect(inBrowser).toBe(false);
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 16; Pixel) Chrome/140 Mobile' });
    expect(isAndroid()).toBe(true);
    expect(isDesktop()).toBe(false);
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15' });
    expect(isAndroid()).toBe(false);
    expect(isDesktop()).toBe(true);
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 16; Pixel) Chrome/140 Mobile' });
    expect(isAndroid()).toBe(false);
    vi.unstubAllGlobals();
  });

  it('in a browser without IndexedDB it falls back to memory, with no native full screen', async () => {
    const platform = createPlatform({ desktop: false });
    await platform.storage.set('a', '1');
    expect(await platform.storage.get('a')).toBe('1');
    expect(platform.setFullscreen).toBeUndefined();
  });
});

describe('desktop project folders (#142)', () => {
  it('reads and writes through the shell, and gathers change events for its own folder', async () => {
    const { desktopOpenFolder } = await import('./desktop.js');
    vi.useFakeTimers();
    const calls: [string, Record<string, unknown> | undefined][] = [];
    const invoke = (async (command: string, args?: Record<string, unknown>) => {
      calls.push([command, args]);
      if (command === 'folder_open') return { id: 7, name: 'my-game' };
      if (command === 'folder_list') return ['game.json'];
      if (command === 'folder_read') return new Uint8Array([123, 125]).buffer;
      return undefined;
    }) as Invoke;
    let handler: ((e: { payload: unknown }) => void) | undefined;
    let stopped = false;
    const listen = async (_event: string, h: (e: { payload: unknown }) => void) => {
      handler = h;
      return () => {
        stopped = true;
      };
    };
    const opened = await desktopOpenFolder(invoke, listen);
    expect(opened?.name).toBe('my-game');
    const store = opened!.store;
    expect(await store.list()).toEqual(['game.json']);
    expect(await store.read('game.json')).toEqual(new Uint8Array([123, 125]));
    await store.write('content/a.json', new Uint8Array([1, 2]));
    expect(calls.at(-1)).toEqual(['folder_write', { id: 7, path: 'content/a.json', data: [1, 2] }]);

    let changes = 0;
    const stop = store.watch!(() => changes++);
    await Promise.resolve();
    handler?.({ payload: 7 });
    handler?.({ payload: 7 });
    handler?.({ payload: 8 });
    vi.advanceTimersByTime(299);
    expect(changes).toBe(0);
    vi.advanceTimersByTime(1);
    expect(changes).toBe(1);
    stop();
    await Promise.resolve();
    expect(stopped).toBe(true);
    vi.useRealTimers();
  });
});

describe('the packages folder (#143)', () => {
  it('reads folder packages file by file and zip packages whole, and installs zips', async () => {
    const { desktopInstallPackage, desktopPackages } = await import('./desktop.js');
    const calls: [string, Record<string, unknown> | undefined][] = [];
    const invoke = (async (command: string, args?: Record<string, unknown>) => {
      calls.push([command, args]);
      if (command === 'packages_list')
        return [
          { kind: 'folder', name: 'duel', files: ['content/a.json', 'game.json'] },
          { kind: 'zip', name: 'spore' },
        ];
      if (command === 'packages_read') return new Uint8Array([args?.path ? 1 : 2]).buffer;
      return undefined;
    }) as Invoke;
    expect(await desktopPackages(invoke)).toEqual([
      { name: 'duel', files: { 'content/a.json': new Uint8Array([1]), 'game.json': new Uint8Array([1]) } },
      { name: 'spore', zip: new Uint8Array([2]) },
    ]);
    await desktopInstallPackage(invoke)('spore', new Uint8Array([9, 9]));
    expect(calls.at(-1)).toEqual(['packages_install', { name: 'spore', data: [9, 9] }]);
    const platform = createPlatform({ desktop: true, invoke: Promise.resolve(invoke) });
    expect(platform.packages).toBeTypeOf('function');
    expect(platform.revealPackages).toBeTypeOf('function');
  });
});
