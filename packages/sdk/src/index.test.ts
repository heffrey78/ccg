import * as core from '@ccg/core';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { ENGINE_API_VERSION, defineCard, defineGame, defineOp, defineStatus } from './index.js';

describe('@ccg/sdk', () => {
  it('re-exports the engine API version from @ccg/core', () => {
    expect(ENGINE_API_VERSION).toBe(core.ENGINE_API_VERSION);
  });

  it('defineGame fills in the format version and wraps custom ops in a module', () => {
    const zap = defineOp({ displayName: 'Zap', description: 'Zap.', params: z.object({}), text: 'Zap.' }, () => {});
    const game = defineGame({
      manifest: { id: 'demo', name: 'Demo', version: '1.0.0', engine: '^0.0.0' },
      ops: { 'demo:zap': zap },
    });
    expect(game.manifest.formatVersion).toBe(1);
    expect(game.content).toEqual([]);
    expect(game.modules?.[0]).toMatchObject({ name: 'demo', ops: { 'demo:zap': zap } });
  });

  it('content helpers produce plain content items', () => {
    expect(defineCard('jab', { name: 'Jab', effects: [{ op: 'damage', amount: 2 }] })).toEqual({
      formatVersion: 1,
      kind: 'card',
      id: 'jab',
      name: 'Jab',
      targeting: { kind: 'none' },
      effects: [{ op: 'damage', amount: 2 }],
    });
    expect(defineStatus('calm', { name: 'Calm', stacking: 'none' })).toMatchObject({ kind: 'status', id: 'calm' });
  });
});
