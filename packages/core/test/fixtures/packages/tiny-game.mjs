// A game package as a plain ES module, loaded by dynamic import in tests.
export default {
  manifest: { formatVersion: 1, id: 'tiny', name: 'Tiny', version: '1.0.0', engine: '^0.0.0' },
  content: [
    { formatVersion: 1, kind: 'card', id: 'poke', name: 'Poke', targeting: { kind: 'none' }, effects: [{ op: 'draw', n: 1 }] },
  ],
};
