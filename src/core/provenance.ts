import type { CachedRaw, Provenance } from './types.js';

export function provenanceFor(raw: CachedRaw, license: string, licenseNote?: string): Provenance {
  return {
    source: raw.source,
    sourceUrl: raw.url,
    fetchedAt: raw.fetchedAt,
    license,
    ...(licenseNote ? { licenseNote } : {}),
  };
}

/**
 * Provenance travels inside each Linked Art record under `_provenance` (record level)
 * and `_fieldProvenance` (per field, only where a field differs from the record).
 * Both are underscore-prefixed so JSON-LD processing ignores them.
 */
export function withProvenance(
  record: Record<string, unknown>,
  prov: Provenance,
  fieldProvenance?: Record<string, Provenance>,
): Record<string, unknown> {
  return {
    ...record,
    _provenance: prov,
    ...(fieldProvenance && Object.keys(fieldProvenance).length ? { _fieldProvenance: fieldProvenance } : {}),
  };
}
