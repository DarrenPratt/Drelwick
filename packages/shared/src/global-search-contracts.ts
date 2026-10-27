import type { ReferenceTarget } from "./reference-contracts.js";

/** Disposable DTOs, never persisted in a project. All offsets are UTF-16. */
export interface GlobalSearchField {
  name: string;
  text: string;
  from?: number;
}
export interface GlobalSearchEntry extends ReferenceTarget {
  title: string;
  fingerprint: string;
  fields: GlobalSearchField[];
}
export interface GlobalSearchSnapshot {
  entries: GlobalSearchEntry[];
  incomplete: boolean;
}
export interface GlobalSearchHit extends ReferenceTarget {
  title: string;
  fingerprint: string;
  field: string;
  fieldIndex: number;
  start: number;
  end: number;
  context: string;
  from?: number;
  to?: number;
}

/** Resource ceilings, independent of product tiers. Strings count UTF-16 units. */
export const GLOBAL_SEARCH_LIMITS = {
  records: 10_000,
  fields: 100_000,
  characters: 16_000_000,
  fieldCharacters: 262_144,
  chapterBytes: 8 * 1024 * 1024,
  sourceBytes: 256 * 1024 * 1024,
  queryCharacters: 500,
  hits: 500,
} as const;
