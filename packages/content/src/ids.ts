/**
 * Content and package ids: lowercase words joined by '-' or '_'. A reference to
 * content in another package is written `packageId:contentId` (decision #14).
 */
const WORD = '[a-z0-9]+(?:[-_][a-z0-9]+)*';

export const ID_PATTERN = new RegExp(`^${WORD}$`);
export const REF_PATTERN = new RegExp(`^(?:${WORD}:)?${WORD}$`);
/** Op ids are code identifiers: camelCase, optionally prefixed by a package id. */
export const OP_ID_PATTERN = new RegExp(`^(?:${WORD}:)?[a-z][A-Za-z0-9]*$`);

export interface Ref {
  /** Undefined for a reference within the same package. */
  package?: string;
  id: string;
}

export function parseRef(ref: string): Ref {
  if (!REF_PATTERN.test(ref)) throw new RangeError(`malformed reference '${ref}'`);
  const colon = ref.indexOf(':');
  return colon < 0 ? { id: ref } : { package: ref.slice(0, colon), id: ref.slice(colon + 1) };
}
