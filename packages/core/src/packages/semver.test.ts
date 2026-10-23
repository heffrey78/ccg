import { describe, expect, it } from 'vitest';
import { satisfies } from './semver.js';

describe('satisfies', () => {
  it.each([
    ['1.2.3', '1.2.3', true],
    ['1.2.4', '1.2.3', false],
    ['1.4.0', '^1.2.3', true],
    ['2.0.0', '^1.2.3', false],
    ['1.2.2', '^1.2.3', false],
    ['0.2.5', '^0.2.3', true],
    ['0.3.0', '^0.2.3', false],
    ['0.0.3', '^0.0.3', true],
    ['0.0.4', '^0.0.3', false],
    ['1.2.9', '~1.2.3', true],
    ['1.3.0', '~1.2.3', false],
    ['2.0.0', '>=1.0.0 <3.0.0', true],
    ['3.0.0', '>=1.0.0 <3.0.0', false],
    ['5.0.0', '^1.0.0 || ^5.0.0', true],
    ['1.0.0-beta', '>=1.0.0', false],
    ['1.0.0', '*', true],
    ['nope', '*', false],
    ['1.0.0', 'garbage', false],
  ])('%s satisfies %s → %s', (version, range, expected) => {
    expect(satisfies(version, range)).toBe(expected);
  });
});
