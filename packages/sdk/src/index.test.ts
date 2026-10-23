import * as core from '@ccg/core';
import { describe, expect, it } from 'vitest';
import { ENGINE_API_VERSION } from './index.js';

describe('@ccg/sdk', () => {
  it('re-exports the engine API version from @ccg/core', () => {
    expect(ENGINE_API_VERSION).toBe(core.ENGINE_API_VERSION);
  });
});
