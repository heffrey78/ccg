import { describe, expect, it } from 'vitest';
import { ENGINE_API_VERSION } from './index.js';

describe('ENGINE_API_VERSION', () => {
  it('is a semver string', () => {
    expect(ENGINE_API_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
