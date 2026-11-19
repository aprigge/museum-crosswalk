import { SourceClient } from '../core/http.js';
import { provenanceFor, withProvenance } from '../core/provenance.js';
import type { CachedRaw, LinkedArtResult, SourceAdapter, SourceArtistRef } from '../core/types.js';
import { qidFromUri } from '../authority/wikidata.js';
import {
  accessionNumber,
  dimension,
  imageRepresentation,
  LA_CONTEXT,
  present,
  primaryName,
  statement,
  webPage,
  wikidataEntity,
  yearSpan,
} from '../linkedart/build.js';
import { AAT } from '../linkedart/vocab.js';

const API = 'https://collectionapi.metmuseum.org/public/collection';
const PAGE = 500; // v1.1 max; offset + limit may not exceed 10,000
const CC0 = 'https://creativecommons.org/publicdomain/zero/1.0/';

type Met = Record<string, any>;
type Constituent = { constituentID: number; role: string; name: string; constituentULAN_URL?: string; constituentWikidata_URL?: string };

/** Fields this adapter maps. Everything else non-empty is reported as unmapped. */
const MAPPED = new Set([
  'objectID', 'title', 'accessionNumber', 'objectDate', 'objectBeginDate', 'objectEndDate', 'medium', 'dimensions',
  'measurements', 'creditLine', 'primaryImage', 'primaryImageSmall', 'additionalImages', 'objectURL',
  'objectWikidata_URL', 'constituents', 'isPublicDomain', 'tags',
  // Artist fields duplicate constituents[0]; read through constituents instead.
  'artistRole', 'artistPrefix', 'artistDisplayName', 'artistDisplayBio', 'artistSuffix', 'artistAlphaSort',
  'artistNationality', 'artistBeginDate', 'artistEndDate', 'artistGender', 'artistWikidata_URL', 'artistULAN_URL',
]);

const lastSegment = (url?: string) => (url ? url.split('/').filter(Boolean).at(-1) : undefined);

export function metLicense(obj: Met): { license: string; note?: string } {
  return obj.isPublicDomain
    ? { license: CC0, note: 'Open Access (isPublicDomain: true)' }
    : { license: 'not-open-access', note: 'isPublicDomain: false; the Met grants CC0 only for Open Access objects' };
}

function person(c: Constituent) {
  const qid = lastSegment(c.constituentWikidata_URL);
  const ulan = lastSegment(c.constituentULAN_URL);
  // The Wikidata URI is the person's id, so only the ULAN link goes in equivalent.
  const equivalent = ulan ? [{ id: `http://vocab.getty.edu/ulan/${ulan}`, type: 'Person' }] : [];
  return { ...(qid ? { id: wikidataEntity(qid) } : {}), type: 'Person', _label: c.name, ...(equivalent.length ? { equivalent } : {}) };
}

export function metToLinkedArt(raw: CachedRaw): LinkedArtResult {
  const o = raw.body as Met;
  const constituents: Constituent[] = o.constituents ?? [];
  const makers = constituents.filter((c) => c.role === 'Artist');
  const unmapped: Record<string, unknown> = present(Object.fromEntries(Object.entries(o).filter(([k]) => !MAPPED.has(k))));

  // Only plain "Artist" constituents map to carried_out_by. Others (Author, Former Attribution, ...)
  // need an AttributeAssignment or a different event, so we report them rather than guess.
  const otherRoles = constituents.filter((c) => c.role !== 'Artist');
  if (otherRoles.length) unmapped['constituents (non-Artist roles)'] = otherRoles.map((c) => `${c.role}: ${c.name}`);
  if (o.artistPrefix) unmapped.artistPrefix = o.artistPrefix;

  const dims: object[] = [];
  const otherElements: unknown[] = [];
  const otherMeasures: Record<string, unknown> = {};
  for (const m of o.measurements ?? []) {
    // Linked Art has no slot for "Framed", "Sheet" etc. on the object itself; keep only Overall.
    if (m.elementName !== 'Overall') {
      otherElements.push(m);
      continue;
    }
    // The API states these numbers in centimetres.
    for (const [k, v] of Object.entries(m.elementMeasurements ?? {})) {
      const dimType = ({ Height: 'height', Width: 'width', Depth: 'depth' } as const)[k as 'Height'];
      if (dimType && typeof v === 'number') dims.push(dimension(v, dimType, AAT.centimetres, 'centimetres'));
      else otherMeasures[k] = v;
    }
  }
  if (otherElements.length) unmapped['measurements (not Overall)'] = otherElements;
  if (Object.keys(otherMeasures).length) unmapped['measurements (other)'] = otherMeasures;

  const statements = [
    o.medium && statement(o.medium, AAT.materialsStatement, 'Materials Statement'),
    o.dimensions && statement(o.dimensions, AAT.dimensionsStatement, 'Dimensions Statement'),
    o.creditLine && statement(o.creditLine, AAT.creditLine, 'Credit Line'),
  ].filter(Boolean);

  const images = [o.primaryImage, ...(o.additionalImages ?? [])].filter(Boolean) as string[];
  // Subjects belong on a VisualItem that `shows` references by id. The Met has no such
  // record, and minting an id would be inventing data, so subject tags stay unmapped.
  if (o.tags?.length) {
    unmapped['tags (subjects need a separate VisualItem record)'] = o.tags.map((t: Met) =>
      [t.term, t.AAT_URL, t.Wikidata_URL].filter(Boolean).join(' '),
    );
  }
  const objectQid = lastSegment(o.objectWikidata_URL);

  const record = present({
    '@context': LA_CONTEXT,
    id: o.objectURL || `${API}/v1/objects/${o.objectID}`,
    type: 'HumanMadeObject',
    _label: o.title || undefined,
    identified_by: [o.title && primaryName(o.title), o.accessionNumber && accessionNumber(o.accessionNumber)].filter(Boolean),
    produced_by: present({
      type: 'Production',
      timespan:
        typeof o.objectBeginDate === 'number' && typeof o.objectEndDate === 'number' && (o.objectDate || o.objectBeginDate)
          ? yearSpan(o.objectBeginDate, o.objectEndDate, o.objectDate || undefined)
          : undefined,
      carried_out_by: makers.map(person),
    }),
    dimension: dims,
    referred_to_by: statements,
    representation: images.map((url) => imageRepresentation(url)),
    subject_of: o.objectURL ? [webPage(o.objectURL)] : undefined,
    equivalent: objectQid ? [{ id: wikidataEntity(objectQid), type: 'HumanMadeObject' }] : undefined,
  });

  // Images follow the same isPublicDomain flag as the record, so no per-field provenance is needed.
  const { license, note } = metLicense(o);
  return { record: withProvenance(record, provenanceFor(raw, license, note)), unmapped };
}

export function metArtistRefs(raw: CachedRaw): SourceArtistRef[] {
  const o = raw.body as Met;
  return ((o.constituents ?? []) as Constituent[]).map((c) => ({
    source: 'met',
    recordId: raw.id,
    name: c.name,
    role: o.artistPrefix && c.name === o.artistDisplayName ? `${c.role} (${o.artistPrefix})` : c.role,
    plainCreator: c.role === 'Artist' && !(o.artistPrefix && c.name === o.artistDisplayName),
    sourceAgentId: String(c.constituentID),
    wikidata: c.constituentWikidata_URL ? qidFromUri(c.constituentWikidata_URL) : undefined,
    ulan: lastSegment(c.constituentULAN_URL),
    // Life years are only given for the primary artist.
    ...(c.name === o.artistDisplayName ? { birth: o.artistBeginDate || undefined, death: o.artistEndDate || undefined } : {}),
  }));
}

export function createMet(opts: { refresh?: boolean } = {}): SourceAdapter {
  const client = new SourceClient({ source: 'met', minIntervalMs: 500, refresh: opts.refresh });

  return {
    name: 'met',

    async *search(artist) {
      const q = encodeURIComponent(artist.name);
      for (let offset = 0; offset < 10_000; offset += PAGE) {
        const url = `${API}/v1.1/search?artistOrCulture=true&q=${q}&offset=${offset}&limit=${PAGE}`;
        const body = (await client.getJson('search', `artist-${artist.name}-o${offset}`, url)).body as Met;
        for (const id of body.objectIDs ?? []) yield String(id);
        if (offset + PAGE >= (body.total ?? 0)) break;
      }
    },

    fetch: (id) => client.getJson('objects', id, `${API}/v1/objects/${id}`),
    toLinkedArt: metToLinkedArt,
    artistRefs: async (raw) => metArtistRefs(raw),
  };
}
