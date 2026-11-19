/** The artist every source is searched for, resolved from Wikidata first. */
export interface ArtistQuery {
  name: string;
  qid: string;
  birth?: string; // ISO date, as Wikidata gives it
  death?: string;
  /** External IDs Wikidata lists for the artist, keyed by property ID (e.g. P650). */
  externalIds: Record<string, { label: string; values: string[] }>;
}

/** A raw response as cached on disk, with the metadata needed for provenance. */
export interface CachedRaw {
  source: string;
  id: string;
  url: string;
  fetchedAt: string;
  body: unknown;
}

export interface Provenance {
  source: string;
  sourceUrl: string;
  fetchedAt: string;
  license: string; // URL or short label as the source states it
  licenseNote?: string;
}

/** What a source record says about its artist, before any matching. */
export interface SourceArtistRef {
  source: string;
  recordId: string;
  name?: string;
  role?: string; // as the source states it, e.g. "Artist", "after", "attributed to"
  /** The adapter's reading of `role` in the source's own vocabulary: false means not simply "made by". */
  plainCreator?: boolean;
  sourceAgentId?: string; // the museum's own ID for the person
  wikidata?: string; // QID if the source links one
  ulan?: string; // ID only if the source itself supplies it; we never fetch Getty
  otherIds?: Record<string, string>;
  birth?: string;
  death?: string;
}

export type MatchMethod = 'exact-id' | 'wikidata-crosswalk' | 'name-dates' | 'none';

export interface ArtistMatch {
  ref: SourceArtistRef;
  qid: string | null;
  method: MatchMethod;
  confidence: number; // 0..1
  evidence: string;
}

export interface LinkedArtResult {
  record: Record<string, unknown>;
  /** Source fields that had no clean Linked Art mapping, with their values. */
  unmapped: Record<string, unknown>;
}

export interface SourceAdapter {
  name: string;
  search(artist: ArtistQuery): AsyncIterable<string>;
  fetch(id: string): Promise<CachedRaw>;
  toLinkedArt(raw: CachedRaw): LinkedArtResult;
  /** What the record says about its artist(s). May read related records from the cache. */
  artistRefs(raw: CachedRaw): Promise<SourceArtistRef[]>;
  /** Harvest-time hook to cache records the object points to (e.g. agent records). */
  fetchRelated?(raw: CachedRaw): Promise<void>;
}
