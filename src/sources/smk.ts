import { readCached, writeCached } from '../core/cache.js';
import { SourceClient } from '../core/http.js';
import { provenanceFor, withProvenance } from '../core/provenance.js';
import type { AdapterOptions, CachedRaw, LinkedArtResult, SourceAdapter, SourceArtistRef } from '../core/types.js';
import { normaliseName } from '../reconcile/match.js';
import { accessionNumber, imageRepresentation, LA_CONTEXT, present, primaryName, statement, webPage, yearSpan } from '../linkedart/build.js';
import { AAT } from '../linkedart/vocab.js';

// SMK, the National Gallery of Denmark: https://api.smk.dk/api/v1 (no key). Records are plain
// JSON; each says its own rights (Public Domain Mark for public-domain works).
const API = 'https://api.smk.dk/api/v1';
const PAGE = 100;

type Smk = Record<string, any>;

const MAPPED = new Set([
  'object_number', 'titles', 'production', 'production_date', 'techniques', 'materials', 'dimensions', 'inscriptions',
  'public_domain', 'rights', 'image_iiif_id', 'image_thumbnail', 'frontend_url', 'credit_line',
]);

export const searchUrl = (creator: string, offset: number) =>
  `${API}/art/search/?keys=*&filters=${encodeURIComponent(`[creator:${creator}]`)}&offset=${offset}&rows=${PAGE}&lang=en`;
const objectUrl = (id: string) => `${API}/art/?object_number=${encodeURIComponent(id)}&lang=en`;

/** The English title if there is one, else the first. */
export function smkTitle(o: Smk): string | undefined {
  const titles = (o.titles ?? []) as Smk[];
  return (titles.find((t) => /engelsk|english/i.test(t.language ?? '')) ?? titles[0])?.title;
}

/** Year span from SMK's ISO production dates. */
export function smkYears(o: Smk): { begin: number; end: number; display?: string } | null {
  const d = (o.production_date ?? [])[0] as Smk | undefined;
  const begin = Number(String(d?.start ?? '').slice(0, 4));
  const end = Number(String(d?.end ?? '').slice(0, 4));
  return begin && end ? { begin, end, display: d?.period } : null;
}

/** SMK states the qualifier per production entry ("copy after", "attributed to"); none means made by. */
export function smkPlainCreator(p: Smk): boolean {
  return !p.creator_qualifier && !(p.creator_role && !/^(artist|kunstner)$/i.test(p.creator_role));
}

export function smkToLinkedArt(raw: CachedRaw): LinkedArtResult {
  const o = raw.body as Smk;
  const unmapped = present(Object.fromEntries(Object.entries(o).filter(([k]) => !MAPPED.has(k))));
  const title = smkTitle(o);
  const years = smkYears(o);
  const open = o.public_domain === true;
  const statements = [
    o.techniques?.length && statement(o.techniques.join('; '), AAT.materialsStatement, 'Materials Statement'),
    o.dimensions?.[0]?.notes && statement(o.dimensions[0].notes, AAT.dimensionsStatement, 'Dimensions Statement'),
    o.credit_line?.length && statement([].concat(o.credit_line).join('; '), AAT.creditLine, 'Credit Line'),
    o.inscriptions?.length &&
      statement((o.inscriptions as Smk[]).map((i) => [i.type, i.content].filter(Boolean).join(': ')).join('; '), AAT.inscriptionStatement, 'Inscription Statement'),
  ].filter(Boolean) as object[];
  const record = present({
    '@context': LA_CONTEXT,
    id: objectUrl(o.object_number),
    type: 'HumanMadeObject',
    _label: title,
    identified_by: [title && primaryName(title), accessionNumber(o.object_number)].filter(Boolean),
    produced_by: present({
      type: 'Production',
      timespan: years ? yearSpan(years.begin, years.end, years.display) : undefined,
      carried_out_by: ((o.production ?? []) as Smk[])
        .filter((p) => p.creator_lref)
        .map((p) => ({ id: `${API}/person/${p.creator_lref}`, type: 'Person', _label: p.creator })),
    }),
    referred_to_by: statements,
    // Images only where the record is public domain; SMK serves IIIF.
    representation: open && o.image_iiif_id ? [imageRepresentation(o.image_thumbnail ?? `${o.image_iiif_id}/full/!1024,/0/default.jpg`, { iiifService: o.image_iiif_id })] : [],
    // Versos have object numbers with a space ("KKS18009 verso"), unencoded in frontend_url.
    subject_of: o.frontend_url ? [webPage(encodeURI(decodeURI(o.frontend_url)))] : undefined,
  });
  const license = o.rights ?? 'not stated in the record';
  const prov = provenanceFor(raw, license, 'As the SMK record states it (`rights`); public-domain works carry the Public Domain Mark');
  return { record: withProvenance(record, prov), related: [], unmapped };
}

export function createSmk(opts: AdapterOptions = {}): SourceAdapter {
  const client = new SourceClient({ source: 'smk', minIntervalMs: 1000, ...opts });

  return {
    name: 'smk',

    /**
     * SMK's creator facet names each person once ("Rembrandt van Rijn"). Search the artist's
     * name, keep creators whose name contains it (as for AIC, "Rembrandts skole" too, so
     * reconcile can flag it), then page through each creator's works. Search pages carry
     * the full records, so each is cached as an object with the page URL as its source.
     */
    async *search(artist) {
      const target = normaliseName(artist.name);
      const facetUrl = `${API}/art/search/?keys=${encodeURIComponent(artist.name)}&rows=0&facets=creator&lang=en`;
      const facet = ((await client.getJson('search', `creators-${artist.name}`, facetUrl)).body as Smk).facets?.creator ?? [];
      const creators: string[] = [];
      for (let i = 0; i < facet.length; i += 2) if (normaliseName(String(facet[i])).includes(target)) creators.push(String(facet[i]));
      const seen = new Set<string>();
      for (const creator of creators) {
        for (let offset = 0; ; offset += PAGE) {
          const page = await client.getJson('search', `creator-${creator}-o${offset}`, searchUrl(creator, offset));
          const body = page.body as Smk;
          for (const item of (body.items ?? []) as Smk[]) {
            const id = String(item.object_number);
            if (seen.has(id)) continue;
            seen.add(id);
            if (opts.refresh || !(await readCached('smk', 'objects', id))) {
              await writeCached('objects', { source: 'smk', id, url: page.url, fetchedAt: page.fetchedAt, body: item });
            }
            yield id;
          }
          if (offset + PAGE >= (body.found ?? 0)) break;
        }
      }
    },

    /** From the cache (filled by search); otherwise one object request. */
    async fetch(id) {
      const hit = opts.refresh ? null : await readCached('smk', 'objects', id);
      if (hit) return hit;
      const res = await client.getJson('object-responses', id, objectUrl(id));
      const item = ((res.body as Smk).items ?? [])[0];
      if (!item) throw new Error(`SMK has no object ${id}`);
      const raw = { source: 'smk', id, url: res.url, fetchedAt: res.fetchedAt, body: item };
      await writeCached('objects', raw);
      return raw;
    },

    toLinkedArt: smkToLinkedArt,

    async artistRefs(raw) {
      const o = raw.body as Smk;
      return ((o.production ?? []) as Smk[]).map(
        (p): SourceArtistRef => ({
          source: 'smk',
          recordId: raw.id,
          name: p.creator,
          role: [p.creator_role, p.creator_qualifier].filter(Boolean).join('; ') || undefined,
          plainCreator: smkPlainCreator(p),
          sourceAgentId: p.creator_lref,
          birth: p.creator_date_of_birth,
          death: p.creator_date_of_death,
        }),
      );
    },
  };
}
