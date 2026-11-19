import { readCached } from '../core/cache.js';
import { SourceClient, USER_AGENT } from '../core/http.js';
import { provenanceFor, withProvenance } from '../core/provenance.js';
import type { CachedRaw, LinkedArtResult, Provenance, SourceAdapter, SourceArtistRef } from '../core/types.js';
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
  'catalogue_display', 'source_updated_at',
];
const AGENT_FIELDS = ['id', 'api_link', 'title', 'alt_titles', 'birth_date', 'death_date', 'ulan_id', 'is_artist'];

const MAPPED = new Set([
  'id', 'api_link', 'title', 'main_reference_number', 'date_start', 'date_end', 'date_display', 'artist_id',
  'artist_ids', 'artist_title', 'artist_titles', 'medium_display', 'dimensions', 'credit_line', 'inscriptions',
  'provenance_text', 'is_public_domain', 'image_id', 'alt_image_ids', 'description', 'short_description',
]);

const artworkUrl = (id: string) => `${API}/artworks/${id}?fields=${ARTWORK_FIELDS.join(',')}`;
const agentUrl = (id: string | number) => `${API}/agents/${id}?fields=${AGENT_FIELDS.join(',')}`;

/** Is `description` real prose? AIC returns null, "" or HTML. */
export function hasText(html: unknown): boolean {
  return typeof html === 'string' && html.replace(/<[^>]+>/g, '').trim().length > 0;
}

/** IIIF Image API URLs built the way the response's own config says: {iiif_url}/{image_id}/... */
export function iiif(iiifBase: string, imageId: string) {
  const service = `${iiifBase}/${imageId}`;
  return { service, full: `${service}/full/843,/0/default.jpg` };
}

export function aicToLinkedArt(raw: CachedRaw): LinkedArtResult {
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
    referred_to_by: statements,
    representation,
    subject_of: [webPage(`https://www.artic.edu/artworks/${a.id}`)],
  });

  const fieldProv: Record<string, Provenance> = {};
  if (hasText(a.description)) {
    fieldProv['referred_to_by[Description]'] = provenanceFor(raw, CC_BY, 'AIC licenses `description` under CC BY 4.0; attribution required');
  }
  return {
    record: withProvenance(record, provenanceFor(raw, CC0, body.info?.license_text), fieldProv),
    unmapped,
  };
}

/** AIC puts qualifiers in the agent's own name ("Imitator of ..."), not in a role. */
export function aicPlainCreator(agentTitle: string | undefined, artistDisplay: string | undefined): boolean {
  if (!agentTitle) return false;
  return !/^(imitator|follower|circle|school|workshop|studio|attributed|after|copy)\b/i.test(agentTitle.trim()) &&
    !(artistDisplay && /\b(attributed to|after|copy after|imitator of|follower of)\b/i.test(artistDisplay));
}

export function createAic(opts: { refresh?: boolean } = {}): SourceAdapter {
  const client = new SourceClient({
    source: 'aic',
    minIntervalMs: 1000,
    // AIC asks clients to identify themselves in this header as well.
    headers: { 'AIC-User-Agent': USER_AGENT },
    refresh: opts.refresh,
  });

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

    fetch: (id) => client.getJson('objects', id, artworkUrl(id)),

    async fetchRelated(raw) {
      for (const id of ((raw.body as Aic).data?.artist_ids ?? []) as number[]) {
        await client.getJson('agents', String(id), agentUrl(id));
      }
    },

    toLinkedArt: aicToLinkedArt,

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
