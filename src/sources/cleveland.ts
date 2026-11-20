import { readCached, writeCached } from '../core/cache.js';
import { SourceClient } from '../core/http.js';
import { provenanceFor, withProvenance } from '../core/provenance.js';
import type { AdapterOptions, CachedRaw, LinkedArtResult, SourceAdapter, SourceArtistRef } from '../core/types.js';
import { accessionNumber, imageRepresentation, LA_CONTEXT, present, primaryName, statement, webPage, yearSpan } from '../linkedart/build.js';
import { AAT } from '../linkedart/vocab.js';

// The Cleveland Museum of Art Open Access API: https://openaccess-api.clevelandart.org (no key).
// All data is CC0; images are CC0 only where `share_license_status` says so.
const API = 'https://openaccess-api.clevelandart.org/api';
const CC0 = 'https://creativecommons.org/publicdomain/zero/1.0/';
const PAGE = 100;

type Cma = Record<string, any>;

const MAPPED = new Set([
  'id', 'accession_number', 'title', 'creation_date', 'creation_date_earliest', 'creation_date_latest', 'creators',
  'technique', 'measurements', 'inscriptions', 'credit_line', 'share_license_status', 'images', 'url',
]);

export const searchUrl = (artist: string, skip: number) =>
  `${API}/artworks/?artists=${encodeURIComponent(artist)}&limit=${PAGE}&skip=${skip}`;
const objectUrl = (id: string) => `${API}/artworks/${id}`;

/** Cleveland states qualifiers ("and", "after", "workshop of") per creator; none means made by. */
export function cmaPlainCreator(c: Cma): boolean {
  return !c.qualifier && (!c.role || /^artist$/i.test(c.role)) && !/^(studio|workshop|school|circle|follower|after)\b/i.test(c.description ?? '');
}

/** "Rembrandt van Rijn (Dutch, 1606–1669)" -> "Rembrandt van Rijn". */
export const cmaName = (c: Cma) => String(c.description ?? '').replace(/\s*\(.*\)\s*$/, '').trim() || undefined;

export function cmaToLinkedArt(raw: CachedRaw): LinkedArtResult {
  const o = raw.body as Cma;
  const unmapped = present(Object.fromEntries(Object.entries(o).filter(([k]) => !MAPPED.has(k))));
  const open = o.share_license_status === 'CC0';
  const web = o.images?.web?.url as string | undefined;
  if (web && !open) unmapped['images (not CC0)'] = o.share_license_status;
  const statements = [
    o.technique && statement(o.technique, AAT.materialsStatement, 'Materials Statement'),
    o.measurements && statement(o.measurements, AAT.dimensionsStatement, 'Dimensions Statement'),
    o.credit_line && statement(o.credit_line, AAT.creditLine, 'Credit Line'),
    o.inscriptions?.length &&
      statement((o.inscriptions as Cma[]).map((i) => i.inscription ?? '').filter(Boolean).join('; '), AAT.inscriptionStatement, 'Inscription Statement'),
  ].filter(Boolean) as object[];
  const begin = Number(o.creation_date_earliest);
  const end = Number(o.creation_date_latest ?? o.creation_date_earliest);
  const record = present({
    '@context': LA_CONTEXT,
    id: objectUrl(String(o.id)),
    type: 'HumanMadeObject',
    _label: o.title || undefined,
    identified_by: [o.title && primaryName(o.title), o.accession_number && accessionNumber(o.accession_number)].filter(Boolean),
    produced_by: present({
      type: 'Production',
      timespan: begin && end ? yearSpan(begin, end, o.creation_date || undefined) : undefined,
      carried_out_by: ((o.creators ?? []) as Cma[]).map((c) => ({ id: `${API}/creators/${c.id}`, type: 'Person', _label: cmaName(c) })),
    }),
    referred_to_by: statements,
    representation: open && web ? [imageRepresentation(web)] : [],
    subject_of: o.url ? [webPage(o.url)] : undefined,
  });
  const prov = provenanceFor(raw, CC0, 'Cleveland Open Access data is CC0; images only where share_license_status is CC0');
  return { record: withProvenance(record, prov), related: [], unmapped };
}

export function createCleveland(opts: AdapterOptions = {}): SourceAdapter {
  const client = new SourceClient({ source: 'cleveland', minIntervalMs: 1000, ...opts });

  return {
    name: 'cleveland',

    /**
     * `artists=` is a text match on creator names, so it also finds prints "after" the artist
     * by others; reconcile sorts them out. Search pages carry full records, cached as objects.
     */
    async *search(artist) {
      const seen = new Set<string>();
      for (let skip = 0; ; skip += PAGE) {
        const page = await client.getJson('search', `artists-${artist.name}-s${skip}`, searchUrl(artist.name, skip));
        const body = page.body as Cma;
        for (const item of (body.data ?? []) as Cma[]) {
          const id = String(item.id);
          if (seen.has(id)) continue;
          seen.add(id);
          if (opts.refresh || !(await readCached('cleveland', 'objects', id))) {
            await writeCached('objects', { source: 'cleveland', id, url: page.url, fetchedAt: page.fetchedAt, body: item });
          }
          yield id;
        }
        if (skip + PAGE >= (body.info?.total ?? 0)) break;
      }
    },

    async fetch(id) {
      const hit = opts.refresh ? null : await readCached('cleveland', 'objects', id);
      if (hit) return hit;
      const res = await client.getJson('object-responses', id, objectUrl(id));
      const raw = { source: 'cleveland', id, url: res.url, fetchedAt: res.fetchedAt, body: (res.body as Cma).data };
      await writeCached('objects', raw);
      return raw;
    },

    toLinkedArt: cmaToLinkedArt,

    async artistRefs(raw) {
      const o = raw.body as Cma;
      // "Rembrandt van Rijn" + "and Studio" is a shared attribution, not plainly his.
      const withStudio = ((o.creators ?? []) as Cma[]).some((c) => /^(studio|workshop)\b/i.test(c.description ?? ''));
      return ((o.creators ?? []) as Cma[]).map(
        (c): SourceArtistRef => ({
          source: 'cleveland',
          recordId: raw.id,
          name: cmaName(c),
          role: [c.role, c.qualifier, c.extent].filter(Boolean).join('; ') || undefined,
          plainCreator: cmaPlainCreator(c) && !withStudio,
          sourceAgentId: String(c.id),
          birth: c.birth_year ?? undefined,
          death: c.death_year ?? undefined,
        }),
      );
    },
  };
}
