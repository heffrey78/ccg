/** Starting points for new projects (#39): a small playable shape on a lane or a grid. */
import { FORMAT_VERSION, type ContentItem } from '@ccg/content';
import { defaultPath, itemKey, type Project } from './project.js';

export type TemplateBoard = 'lane' | 'grid';

export const TEMPLATES: readonly { board: TemplateBoard; name: string; description: string }[] = [
  { board: 'lane', name: 'Blank lane game', description: 'A one-row board: a hero, an enemy and a starter card.' },
  { board: 'grid', name: 'Blank grid game', description: 'A square grid: a hero, an enemy and a starter card.' },
];

export function blankProject(options: { id: string; name: string; board: TemplateBoard }): Project {
  const v = FORMAT_VERSION;
  const [heroPos, foePos] = options.board === 'lane' ? ['0', '6'] : ['1,3', '5,3'];
  const items: ContentItem[] = [
    {
      formatVersion: v,
      kind: 'card',
      id: 'strike',
      name: 'Strike',
      cost: { energy: 1 },
      targeting: { kind: 'unit', filter: 'enemy', range: 1 },
      effects: [{ op: 'damage', amount: 6 }],
    },
    { formatVersion: v, kind: 'unit', id: 'hero', name: 'Hero', hp: 30 },
    {
      formatVersion: v,
      kind: 'unit',
      id: 'foe',
      name: 'Foe',
      hp: 20,
      behavior: {
        kind: 'intent',
        intent: { name: 'Hit', target: { kind: 'unit', select: 'nearestEnemy', range: 1 }, effects: [{ op: 'damage', amount: 5 }] },
      },
    },
    {
      formatVersion: v,
      kind: 'encounter',
      id: 'first-fight',
      name: 'First Fight',
      units: [
        { unit: 'hero', side: 'player', pos: heroPos, facing: 'e' },
        { unit: 'foe', side: 'enemy', pos: foePos, facing: 'w' },
      ],
    },
  ];
  return {
    manifest: { formatVersion: v, id: options.id, name: options.name, version: '0.1.0', engine: '^0.0.0' },
    items: Object.fromEntries(items.map((i) => [itemKey(i.kind, i.id), i])),
    paths: Object.fromEntries(items.map((i) => [itemKey(i.kind, i.id), defaultPath(i.kind, i.id)])),
    assets: {},
    other: {},
  };
}

/** The smallest valid item of each kind, for "New …" in the content browser. */
export function newItem(kind: ContentItem['kind'], id: string, name: string): ContentItem {
  const base = { formatVersion: FORMAT_VERSION, kind, id, name };
  switch (kind) {
    case 'card':
      return { ...base, targeting: { kind: 'none' }, effects: [] };
    case 'unit':
      return { ...base, hp: 10 };
    case 'status':
      return { ...base, stacking: 'intensity' };
    case 'tile':
      return base;
    case 'encounter':
      return { ...base, units: [] };
  }
}
