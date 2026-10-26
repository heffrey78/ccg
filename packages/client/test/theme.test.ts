import { describe, expect, it } from 'vitest';
import { themeCss } from '../src/ui/theme.js';

describe('themeCss', () => {
  const css = themeCss(
    {
      colors: { panel: '#222222', ink: '#eeeeee', bogus: '#000000' },
      fonts: { display: { family: 'Spore Serif', url: 'blob:x' }, body: { family: 'serif' } },
      table: { color: '#101010', image: 'blob:t"able' },
      frames: [
        { id: 'puff', layout: 'full-art', fill: '#334455', accent: '#ff8800' },
        { id: 'plain', layout: 'standard' },
      ],
    },
    '.ccg-themed',
  );

  it('sets the colour tokens it knows, on the scope and the page around it', () => {
    expect(css).toContain('.ccg-app:has(.ccg-themed), .ccg-themed { --panel: #222222; --ink: #eeeeee; }');
    expect(css).not.toContain('bogus');
  });

  it('loads bundled fonts, falls back to named ones, and quotes URLs safely', () => {
    expect(css).toContain('@font-face { font-family: "ccg-display"; src: url("blob:x");');
    expect(css).toContain('.ccg-themed { font-family: "serif", system-ui, sans-serif; }');
    expect(css).toContain('.ccg-themed .ccg-card-name');
    expect(css).toContain('url("blob:table")');
  });

  it('styles each frame and its layout; a frame with nothing set adds nothing', () => {
    expect(css).toContain('.ccg-themed .ccg-card[data-frame="puff"] { --card-fill: #334455; background-color: #334455; }');
    expect(css).toContain('.ccg-themed .ccg-card[data-frame="puff"] .ccg-card-cost { background: #ff8800; }');
    expect(css).toContain('.ccg-themed .ccg-card[data-frame="puff"] .ccg-card-art { position: absolute;');
    expect(css).not.toContain('data-frame="plain"');
  });

  it('is empty for an empty theme', () => {
    expect(themeCss({ colors: {}, fonts: {}, frames: [] }, '.x')).toBe('');
  });
});
