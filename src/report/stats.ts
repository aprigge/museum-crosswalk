import type { ArtistMatch, ArtistQuery, Provenance } from '../core/types.js';
import { recordStatus, SOURCE_PROPERTY_LABELS, type RecordStatus } from '../reconcile/match.js';
import { schemaErrorKind } from '../linkedart/validate.js';
import { AAT, sameTerm } from '../linkedart/vocab.js';

type Node = Record<string, any>;

/** Licenses that allow reuse without asking: CC0, Public Domain Mark, CC BY (with attribution). */
const OPEN_LICENSES = [
  'https://creativecommons.org/publicdomain/zero/1.0/',
  'https://creativecommons.org/publicdomain/mark/1.0/',
  'https://creativecommons.org/licenses/by/4.0/',
];
export const isOpenLicense = (license?: string) => !!license && OPEN_LICENSES.includes(license.replace(/^http:/, 'https:'));

export const LICENSE_NAMES: Record<string, string> = {
  'https://creativecommons.org/publicdomain/zero/1.0/': 'CC0 1.0',
  'https://creativecommons.org/publicdomain/mark/1.0/': 'Public Domain Mark 1.0',
  'https://creativecommons.org/licenses/by/4.0/': 'CC BY 4.0',
};
export const licenseName = (l: string) => LICENSE_NAMES[l] ?? l;

/** Image URLs in a converted record, wherever the source put them. */
export function imageUrls(record: Node): string[] {
  const urls: string[] = [];
  for (const rep of record.representation ?? []) {
    for (const d of rep.digitally_shown_by ?? []) for (const ap of d.access_point ?? []) urls.push(ap.id);
  }
  // Rijksmuseum puts images under subject_of, next to the web page.
  for (const s of record.subject_of ?? []) {
    for (const d of s.digitally_carried_by ?? []) {
      if (d.format === 'text/html' || (d.classified_as ?? []).some((c: Node) => sameTerm(c.id, AAT.webPage))) continue;
      for (const ap of d.access_point ?? []) urls.push(ap.id);
    }
  }
  return urls;
}

/** The license that applies to the images: a per-field override if there is one, else the record's. */
export function imageLicense(record: Node): string | undefined {
  const fields = (record._fieldProvenance ?? {}) as Record<string, Provenance>;
  const override = Object.entries(fields).find(([k]) => /image|representation/.test(k));
  return override?.[1].license ?? (record._provenance as Provenance | undefined)?.license;
}

export const hasOpenImage = (record: Node) => imageUrls(record).length > 0 && isOpenLicense(imageLicense(record));

/** Real description prose: a top-level Description statement with text once HTML is stripped. */
export function hasDescription(record: Node): boolean {
  return (record.referred_to_by ?? []).some(
    (s: Node) =>
      (s.classified_as ?? []).some((c: Node) => sameTerm(c.id, AAT.description)) &&
      typeof s.content === 'string' &&
      s.content.replace(/<[^>]+>/g, '').trim().length > 0,
  );
}

export interface SourceData {
  name: string;
  harvest: { searchHits: number; errors: { id: string; error: string }[] } | null;
  records: Record<string, Node>; // by record id
  validation: Record<string, { schema: string[]; jsonld: string[] }>;
  unmapped: Record<string, Record<string, unknown>>;
  matches: { recordId: string; matches: ArtistMatch[] }[];
}

export function statusCounts(src: SourceData, qid: string): Record<RecordStatus, string[]> {
  const out: Record<RecordStatus, string[]> = {
    confirmed: [],
    'crosswalk-only': [],
    qualified: [],
    'other-artist': [],
    'no-artist': [],
  };
  for (const r of src.matches) out[recordStatus(r.matches, qid)].push(r.recordId);
  return out;
}

/** Works the artist plainly made, by exact ID or crosswalk: the set the report's coverage numbers use. */
export function artistWorks(src: SourceData, qid: string): string[] {
  const s = statusCounts(src, qid);
  return [...s.confirmed, ...s['crosswalk-only']];
}

export function countBy<T>(items: T[], key: (t: T) => string | null): [string, number][] {
  const m = new Map<string, number>();
  for (const i of items) {
    const k = key(i);
    if (k !== null) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Schema problems by kind, counted once per record rather than per occurrence. */
export function schemaErrorKinds(src: SourceData): [string, number][] {
  return countBy(
    Object.values(src.validation).flatMap((v) => [...new Set(v.schema.map(schemaErrorKind).filter((k): k is string => !!k))]),
    (k) => k,
  );
}

export function unmappedFields(src: SourceData): { field: string; records: number; example: unknown }[] {
  const byField = new Map<string, { records: number; example: unknown }>();
  for (const fields of Object.values(src.unmapped)) {
    for (const [field, value] of Object.entries(fields)) {
      const entry = byField.get(field) ?? { records: 0, example: value };
      entry.records++;
      byField.set(field, entry);
    }
  }
  return [...byField.entries()]
    .map(([field, v]) => ({ field, ...v }))
    .sort((a, b) => b.records - a.records || a.field.localeCompare(b.field));
}

/** Linked Art properties each source's converted records use, with how many records have each. */
export function linkedArtProperties(src: SourceData): [string, number][] {
  return countBy(
    Object.values(src.records).flatMap((r) => Object.keys(r).filter((k) => !k.startsWith('_') && k !== '@context')),
    (k) => k,
  );
}

/** Wikidata external-ID properties that belong to this source, as Wikidata lists them for the artist. */
export function wikidataIdsForSource(artist: ArtistQuery, source: string): { pid: string; label: string; values: string[] }[] {
  const re = SOURCE_PROPERTY_LABELS[source];
  if (!re) return [];
  return Object.entries(artist.externalIds)
    .filter(([, p]) => re.test(p.label))
    .map(([pid, p]) => ({ pid, ...p }));
}

export function licenseCounts(src: SourceData): { record: [string, number][]; fields: [string, number][] } {
  const recs = Object.values(src.records);
  return {
    record: countBy(recs, (r) => licenseName((r._provenance as Provenance).license)),
    fields: countBy(
      recs.flatMap((r) =>
        Object.entries((r._fieldProvenance ?? {}) as Record<string, Provenance>).map(
          ([k, p]) => `${k.replace(/\[image \d+\]/, '[image]')}: ${licenseName(p.license)}`,
        ),
      ),
      (k) => k,
    ),
  };
}
