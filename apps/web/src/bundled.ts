/**
 * What the app knows about its bundled games without loading them: names
 * and where their files live in the repository. Their files load on demand.
 */
import type { InstalledGame } from '@ccg/editor/ui';

const manifests = import.meta.glob(['../../../examples/duel/game.json', '../../../games/reference/game.json'], { eager: true, import: 'default' }) as Record<string, { id: string; name: string; description?: string }>;
const FOLDERS: Record<string, string> = { duel: 'examples/duel', sporeline: 'games/reference' };

export const INSTALLED: InstalledGame[] = Object.values(manifests).map((m) => ({
  id: m.id,
  name: m.name,
  ...(m.description && { description: m.description }),
  ...(FOLDERS[m.id] && { folder: FOLDERS[m.id] }),
  files: () => import('./bundled-files.js').then((b) => b.bundledFiles(m.id)),
}));
