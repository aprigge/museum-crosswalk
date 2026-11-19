import { createHash } from 'node:crypto';
import { listCached, readCached, writeCached } from '../core/cache.js';
import { SourceClient, USER_AGENT } from '../core/http.js';
import { provenanceFor, withProvenance } from '../core/provenance.js';
import type { AdapterOptions, CachedRaw, LinkedArtResult, Provenance, SliceQuery, SourceAdapter, SourceArtistRef } from '../core/types.js';
import { mint } from '../core/ids.js';
import { normaliseName } from '../reconcile/match.js';
import {
  accessionNumber,
  imageRepresentation,
  LA_CONTEXT,
  present,
  primaryName,
  statement,
  webPage,
  yearSpan,
} from '../linkedart/build.js';
import { AAT } from '../linkedart/vocab.js';

const API = 'https://api.artic.edu/api/v1';
const CC0 = 'https://creativecommons.org/publicdomain/zero/1.0/';
const CC_BY = 'https://creativecommons.org/licenses/by/4.0/';
const PAGE = 100;

type Aic = Record<string, any>;

/** Requested with `fields=`: everything we map, plus what the report lists as unmapped. */
export const ARTWORK_FIELDS = [
  'id', 'api_link', 'title', 'alt_titles', 'main_reference_number', 'date_start', 'date_end', 'date_display',
  'date_qualifier_title', 'artist_id', 'artist_ids', 'artist_title', 'artist_titles', 'artist_display', 'alt_artist_ids',
  'place_of_origin', 'medium_display', 'dimensions', 'dimensions_detail', 'credit_line', 'inscriptions',
  'provenance_text', 'publication_history', 'exhibition_history', 'copyright_notice', 'is_public_domain', 'image_id',
  'alt_image_ids', 'description', 'short_description', 'classification_title', 'artwork_type_title',
  'department_title', 'material_titles', 'technique_titles', 'style_titles', 'subject_titles', 'edition',
  'catalogue_display', 'source_updated_at', 'style_ids', 'subject_ids',
];
const AGENT_FIELDS = ['id', 'api_link', 'title', 'alt_titles', 'birth_date', 'death_date', 'ulan_id', 'is_artist'];
const TERM_FIELDS = ['id', 'api_link', 'title', 'subtype', 'aat_id', 'parent_id'];

const MAPPED = new Set([
  'id', 'api_link', 'title', 'main_reference_number', 'date_start', 'date_end', 'date_display', 'artist_id',
  'artist_ids', 'artist_title', 'artist_titles', 'medium_display', 'dimensions', 'credit_line', 'inscriptions',
  'provenance_text', 'is_public_domain', 'image_id', 'alt_image_ids', 'description', 'short_description',
  // Mapped through the cached category terms (style -> classified_as, subjects -> VisualItem).
  'style_ids', 'subject_ids', 'style_titles', 'subject_titles',
]);

const artworkUrl = (id: string) => `${API}/artworks/${id}?fields=${ARTWORK_FIELDS.join(',')}`;
const agentUrl = (id: string | number) => `${API}/agents/${id}?fields=${AGENT_FIELDS.join(',')}`;
const BATCH = 100; // AIC list endpoints accept up to 100 ids

/** Search URL for the paintings in a year range, by AIC's own artwork type and start date. */
export function sliceSearchUrl(slice: SliceQuery, page: number): string {
  const p = new URLSearchParams({
    'query[bool][must][0][term][artwork_type_id]': '1', // "Painting"
    'query[bool][must][1][range][date_start][gte]': String(slice.from),
    'query[bool][must][2][range][date_start][lte]': String(slice.to),
    fields: 'id',
    limit: String(PAGE),
    page: String(page),
  });
  return `${API}/artworks/search?${p}`;
}

export interface AicTerm {
  id: string;
  title: string;
  subtype: 'style' | 'subject' | string;
  aat_id: number | null;
}

/** A category term as a Linked Art Type: its AAT URI when AIC gives one, else AIC's own API URI. */
export function termType(t: AicTerm) {
  return {
    id: t.aat_id ? `http://vocab.getty.edu/aat/${t.aat_id}` : `${API}/category-terms/${t.id}`,
    type: 'Type',
    _label: t.title,
  };
}

/** Is `description` real prose? AIC returns null, "" or HTML. */
export function hasText(html: unknown): boolean {
  return typeof html === 'string' && html.replace(/<[^>]+>/g, '').trim().length > 0;
}

/** IIIF Image API URLs built the way the response's own config says: {iiif_url}/{image_id}/... */
export function iiif(iiifBase: string, imageId: string) {
  const service = `${iiifBase}/${imageId}`;
  return { service, full: `${service}/full/843,/0/default.jpg` };
}

/**
 * Convert one AIC artwork. `terms` holds the cached category terms; without them, styles and
 * subjects are reported as unmapped rather than guessed from their titles.
 */
export function aicToLinkedArt(raw: CachedRaw, terms: Map<string, AicTerm> = new Map()): LinkedArtResult {
  const body = raw.body as Aic;
  const a = body.data as Aic;
  const iiifBase: string | undefined = body.config?.iiif_url;
  const unmapped = present(Object.fromEntries(Object.entries(a).filter(([k]) => !MAPPED.has(k))));
  if (a.dimensions_detail) {
    unmapped.dimensions_detail = {
      note: 'Structured values are whole centimetres and disagree with the display text; mapped the text only',
      value: a.dimensions_detail,
    };
  }

  const carriedOutBy = ((a.artist_ids ?? []) as number[]).map((id, i) => ({
    id: `${API}/agents/${id}`,
    type: 'Person',
    ...(a.artist_titles?.[i] ? { _label: a.artist_titles[i] } : {}),
  }));

  const statements = [
    a.medium_display && statement(a.medium_display, AAT.materialsStatement, 'Materials Statement'),
    a.dimensions && statement(a.dimensions, AAT.dimensionsStatement, 'Dimensions Statement'),
    a.credit_line && statement(a.credit_line, AAT.creditLine, 'Credit Line'),
    a.inscriptions && statement(a.inscriptions, AAT.inscriptionStatement, 'Inscription Statement'),
    a.provenance_text && statement(a.provenance_text, AAT.provenanceStatement, 'Provenance Statement'),
    hasText(a.short_description) && statement(a.short_description, AAT.summary, 'Summary'),
  ].filter(Boolean) as object[];
  // `description` is the only CC-BY field; keep it last so its field provenance is easy to find.
  if (hasText(a.description)) statements.push({ ...statement(a.description, AAT.description, 'Description'), format: 'text/html' });

  const imageIds = [a.image_id, ...(a.alt_image_ids ?? [])].filter(Boolean) as string[];
  if (imageIds.length && !iiifBase) unmapped.images = { note: 'No config.iiif_url in response', imageIds };
  const representation =
    iiifBase && a.is_public_domain
      ? imageIds.map((id) => {
          const u = iiif(iiifBase, id);
          return imageRepresentation(u.full, { iiifService: u.service });
        })
      : [];
  if (imageIds.length && !a.is_public_domain) unmapped['images (not public domain)'] = imageIds;

  const lookup = (ids: string[] | undefined) => {
    const found: AicTerm[] = [];
    const missing: string[] = [];
    for (const id of ids ?? []) {
      const t = terms.get(id);
      if (t) found.push(t);
      else missing.push(id);
    }
    return { found, missing };
  };
  const styles = lookup(a.style_ids);
  const subjects = lookup(a.subject_ids);
  const missingTerms = [...styles.missing, ...subjects.missing];
  if (missingTerms.length) unmapped['category terms (not cached)'] = missingTerms;

  // Linked Art puts subjects on a VisualItem that the object `shows`. AIC has no such record,
  // so we mint one under the project's own URI space.
  const visualId = mint.visual('aic', String(a.id));
  const visual = subjects.found.length
    ? present({
        '@context': LA_CONTEXT,
        id: visualId,
        type: 'VisualItem',
        _label: `Subjects of ${a.title ?? `AIC artwork ${a.id}`}`,
        about: subjects.found.map(termType),
      })
    : null;

  const record = present({
    '@context': LA_CONTEXT,
    id: `${API}/artworks/${a.id}`,
    type: 'HumanMadeObject',
    _label: a.title || undefined,
    identified_by: [a.title && primaryName(a.title), a.main_reference_number && accessionNumber(a.main_reference_number)].filter(Boolean),
    produced_by: present({
      type: 'Production',
      timespan:
        typeof a.date_start === 'number' && typeof a.date_end === 'number'
          ? yearSpan(a.date_start, a.date_end, a.date_display || undefined)
          : undefined,
      carried_out_by: carriedOutBy,
    }),
    classified_as: styles.found.map((t) => ({ ...termType(t), classified_as: [{ id: AAT.style, type: 'Type', _label: 'Style' }] })),
    referred_to_by: statements,
    representation,
    shows: visual ? [{ id: visualId, type: 'VisualItem' }] : undefined,
    subject_of: [webPage(`https://www.artic.edu/artworks/${a.id}`)],
  });

  const fieldProv: Record<string, Provenance> = {};
  if (hasText(a.description)) {
    fieldProv['referred_to_by[Description]'] = provenanceFor(raw, CC_BY, 'AIC licenses `description` under CC BY 4.0; attribution required');
  }
  const prov = provenanceFor(raw, CC0, body.info?.license_text);
  return {
    record: withProvenance(record, prov, fieldProv),
    related: visual ? [withProvenance(visual, prov)] : [],
    unmapped,
  };
}

/** AIC puts qualifiers in the agent's own name ("Imitator of ..."), not in a role. */
export function aicPlainCreator(agentTitle: string | undefined, artistDisplay: string | undefined): boolean {
  if (!agentTitle) return false;
  return !/^(imitator|follower|circle|school|workshop|studio|attributed|after|copy)\b/i.test(agentTitle.trim()) &&
    !(artistDisplay && /\b(attributed to|after|copy after|imitator of|follower of)\b/i.test(artistDisplay));
}

export function createAic(opts: AdapterOptions = {}): SourceAdapter {
  const client = new SourceClient({
    source: 'aic',
    minIntervalMs: 1000,
    // AIC asks clients to identify themselves in this header as well.
    headers: { 'AIC-User-Agent': USER_AGENT },
    ...opts,
  });
  const terms = new Map<string, AicTerm>();

  /**
   * Fetch records not yet cached through AIC's list endpoint (`?ids=`, up to 100 at once),
   * then cache each one under its own id so later lookups are by id. Each keeps the batch
   * URL it actually came from, for provenance.
   */
  async function cacheBatch(kind: 'agents' | 'terms', ids: string[], fields: string[]) {
    const missing: string[] = [];
    for (const id of new Set(ids)) if (!(await readCached('aic', kind, id))) missing.push(id);
    const endpoint = kind === 'agents' ? 'agents' : 'category-terms';
    for (let i = 0; i < missing.length; i += BATCH) {
      const chunk = missing.slice(i, i + BATCH);
      const url = `${API}/${endpoint}?ids=${chunk.join(',')}&fields=${fields.join(',')}&limit=${BATCH}`;
      const key = createHash('sha1').update(chunk.join(',')).digest('hex').slice(0, 16);
      const batch = await client.getJson(`${kind}-batches`, key, url);
      const body = batch.body as Aic;
      for (const rec of (body.data ?? []) as Aic[]) {
        await writeCached(kind, { source: 'aic', id: String(rec.id), url, fetchedAt: batch.fetchedAt, body: { data: rec, info: body.info } });
      }
    }
  }

  return {
    name: 'aic',

    /**
     * Find the artist's AIC agent records by name, then every artwork for each.
     * Agents whose name contains the artist's (e.g. "Imitator of Vincent van Gogh")
     * are searched too so reconcile can see and flag them.
     */
    async *search(artist) {
      const target = normaliseName(artist.name);
      const q = encodeURIComponent(artist.name);
      const agents = (await client.getJson('search', `agents-${artist.name}`, `${API}/agents/search?q=${q}&fields=id,title&limit=${PAGE}`)).body as Aic;
      const ids = ((agents.data ?? []) as Aic[]).filter((ag) => normaliseName(ag.title ?? '').includes(target)).map((ag) => ag.id);
      const seen = new Set<string>();
      for (const agentId of ids) {
        for (let page = 1; ; page++) {
          const url = `${API}/artworks/search?query[term][artist_ids]=${agentId}&fields=id&limit=${PAGE}&page=${page}`;
          const res = (await client.getJson('search', `artworks-agent-${agentId}-p${page}`, url)).body as Aic;
          for (const hit of res.data ?? []) {
            const id = String(hit.id);
            if (!seen.has(id)) {
              seen.add(id);
              yield id;
            }
          }
          if (page >= (res.pagination?.total_pages ?? 1)) break;
        }
      }
    },

    async *searchSlice(slice) {
      if (slice.type !== 'painting') throw new Error(`AIC slice type ${slice.type} not supported`);
      for (let page = 1; ; page++) {
        const res = (await client.getJson('search', `${slice.id}-p${page}`, sliceSearchUrl(slice, page))).body as Aic;
        for (const hit of res.data ?? []) yield String(hit.id);
        if (page >= (res.pagination?.total_pages ?? 1)) break;
      }
    },

    fetch: (id) => client.getJson('objects', id, artworkUrl(id)),

    async fetchRelated(raw) {
      const a = (raw.body as Aic).data as Aic;
      await cacheBatch('agents', (a.artist_ids ?? []).map(String), AGENT_FIELDS);
      await cacheBatch('terms', [...(a.style_ids ?? []), ...(a.subject_ids ?? [])], TERM_FIELDS);
    },

    async prepareTransform() {
      terms.clear();
      for (const raw of await listCached('aic', 'terms')) terms.set(raw.id, (raw.body as Aic).data as AicTerm);
    },

    toLinkedArt: (raw) => aicToLinkedArt(raw, terms),

    async artistRefs(raw) {
      const a = (raw.body as Aic).data as Aic;
      const refs: SourceArtistRef[] = [];
      for (const id of (a.artist_ids ?? []) as number[]) {
        const agent = (await readCached('aic', 'agents', String(id)))?.body as Aic | undefined;
        const ag = agent?.data as Aic | undefined;
        const name = ag?.title ?? a.artist_titles?.[(a.artist_ids as number[]).indexOf(id)];
        refs.push({
          source: 'aic',
          recordId: raw.id,
          name,
          role: a.artist_display ? `artist_display: ${a.artist_display}` : undefined,
          plainCreator: aicPlainCreator(name, a.artist_display),
          sourceAgentId: String(id),
          ulan: ag?.ulan_id ? String(ag.ulan_id) : undefined,
          birth: ag?.birth_date ? String(ag.birth_date) : undefined,
          death: ag?.death_date ? String(ag.death_date) : undefined,
        });
      }
      return refs;
    },
  };
}
