import type { CachedRaw, Provenance } from '../core/types.js';
import { AAT, sameTerm } from '../linkedart/vocab.js';

type Node = Record<string, any>;

const CONCEPT_URI = /vocab\.getty\.edu\/aat\/|iconclass\.org\/|wikidata\.org\/entity\/|api\.artic\.edu\/api\/v1\/category-terms\//;

export interface ConceptRef {
  uri: string; // as the record uses it
  label?: string; // the record's own label, when it gives one
  equivalents: string[]; // further URIs the record says are the same
}

/** Styles (classified_as with the Style metatype) and subjects (on the VisualItems the work shows). */
export function workConcepts(record: Node, related: Node[]): { styles: ConceptRef[]; subjects: ConceptRef[] } {
  const ref = (t: Node): ConceptRef => ({
    uri: String(t.id),
    label: t._label,
    equivalents: (t.equivalent ?? []).map((e: Node) => String(e.id)).filter((u: string) => CONCEPT_URI.test(u)),
  });
  const styles = (record.classified_as ?? [])
    .filter((c: Node) => (c.classified_as ?? []).some((m: Node) => sameTerm(m.id, AAT.style)))
    .map(ref);
  const subjects: ConceptRef[] = [];
  for (const v of related) {
    for (const key of ['about', 'represents_instance_of_type', 'represents']) {
      for (const t of v[key] ?? []) if (t?.id) subjects.push(ref(t));
    }
  }
  return { styles, subjects };
}

/** Every concept URI a work uses, including equivalents (for the concept lookup). */
export function conceptUris(record: Node, related: Node[]): string[] {
  const { styles, subjects } = workConcepts(record, related);
  return [...styles, ...subjects].flatMap((c) => [c.uri, ...c.equivalents]).filter((u) => CONCEPT_URI.test(u));
}

/** The work's title: Linked Art `_label`, else an English Name, else the first Name. */
export function workTitle(record: Node): string | undefined {
  if (record._label) return String(record._label);
  const names = (record.identified_by ?? []).filter((n: Node) => n.type === 'Name');
  const english = names.find((n: Node) => (n.language ?? []).some((l: Node) => sameTerm(l.id, AAT.english)));
  return (english ?? names[0])?.content;
}

export function workYears(record: Node): { begin?: number; end?: number } {
  const ts = record.produced_by?.timespan;
  const y = (s: unknown) => (typeof s === 'string' && /^-?\d{4}/.test(s) ? Number(s.slice(0, 4)) : undefined);
  return { begin: y(ts?.begin_of_the_begin), end: y(ts?.end_of_the_end) };
}

/** The museum's own web page for the work. */
export function webPageUrl(record: Node): string | undefined {
  for (const s of record.subject_of ?? []) {
    for (const d of s.digitally_carried_by ?? []) {
      if (d.format === 'text/html' || (d.classified_as ?? []).some((c: Node) => sameTerm(c.id, AAT.webPage))) {
        return d.access_point?.[0]?.id;
      }
    }
  }
  return undefined;
}

/**
 * A small image for search results, only where the image is openly licensed. Built the way
 * each source serves sizes: IIIF size parameters (AIC, SMK, Rijksmuseum), the Met's own small file,
 * Cleveland's web-size JPEG.
 */
export function thumbnail(source: string, record: Node, raw: CachedRaw): string | undefined {
  const prov = record._provenance as Provenance | undefined;
  if (source === 'met') {
    const o = raw.body as Node;
    return o.isPublicDomain && o.primaryImageSmall ? encodeURI(decodeURI(o.primaryImageSmall)) : undefined;
  }
  if (source === 'aic' || source === 'smk') {
    const service = record.representation?.[0]?.digitally_shown_by?.[0]?.digitally_available_via?.[0]?.access_point?.[0]?.id;
    return service ? `${service}/full/400,/0/default.jpg` : undefined;
  }
  if (source === 'cleveland') {
    // Only CC0 images are mapped to a representation; Cleveland's "web" size is ~900 px.
    return record.representation?.[0]?.digitally_shown_by?.[0]?.access_point?.[0]?.id;
  }
  if (source === 'rijksmuseum') {
    for (const s of record.subject_of ?? []) {
      for (const d of s.digitally_carried_by ?? []) {
        const url: string | undefined = d.access_point?.[0]?.id;
        const license: string | undefined = d.referred_to_by?.[0]?.content;
        const open = license ? /publicdomain|creativecommons/.test(license) : prov?.license?.includes('publicdomain');
        if (url && /\/full\/max\//.test(url) && open) return url.replace('/full/max/', '/full/400,/');
      }
    }
  }
  return undefined;
}
