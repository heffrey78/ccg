/**
 * Format-version migrations for content files (#34). Each step upgrades a
 * document from version n to n + 1; the migrator chains them up to current.
 */
import { FORMAT_VERSION } from './format.js';

export type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

export type MigrateResult =
  | { ok: true; doc: Record<string, unknown>; migrated: boolean }
  | { ok: false; message: string };

export class Migrator {
  constructor(
    readonly current: number,
    private readonly steps: Readonly<Record<number, Migration>>,
  ) {}

  migrate(input: unknown): MigrateResult {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return { ok: false, message: 'expected a JSON object' };
    }
    let doc = input as Record<string, unknown>;
    const version = doc.formatVersion;
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      return { ok: false, message: 'formatVersion must be a positive integer' };
    }
    if (version > this.current) {
      return {
        ok: false,
        message: `formatVersion ${version} is newer than this engine supports (${this.current})`,
      };
    }
    for (let v = version; v < this.current; v++) {
      const step = this.steps[v];
      if (!step) return { ok: false, message: `no migration from formatVersion ${v}` };
      doc = { ...step(doc), formatVersion: v + 1 };
    }
    return { ok: true, doc, migrated: version < this.current };
  }
}

/** The engine's migrations. Empty until the format first changes. */
export const migrator = new Migrator(FORMAT_VERSION, {});
