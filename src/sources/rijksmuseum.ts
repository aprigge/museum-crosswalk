import { readCached } from '../core/cache.js';
import { SourceClient } from '../core/http.js';
import { provenanceFor, withProvenance } from '../core/provenance.js';
import type { ArtistQuery, CachedRaw, LinkedArtResult, SourceAdapter, SourceArtistRef } from '../core/types.js';
import { qidFromUri } from '../authority/wikidata.js';
import { AAT, sameTerm } from '../linkedart/vocab.js';

const SEARCH = 'https://data.rijksmuseum.nl/search/collection';
const PID = 'https://id.rijksmuseum.nl/';

type Node = Record<string, any>;

const numericId = (uri: string) => uri.replace(PID, '');
const resolveUrl = (id: string) => `${PID}${id}?_profile=la-framed`;

/**
 * Search terms for an artist. The Rijksmuseum `creator` param is a partial name
 * match with no ID filter, so we also search the surname to see what the full
 * name misses; reconcile sorts out which hits are really the artist.
 */
export function searchTerms(artist: ArtistQuery): string[] {
  const surname = artist.name.split(/\s+/).at(-1)!;
  return [...new Set([artist.name, surname])];
}

/** People named in production, with how the record links them. */
export function productionAgents(obj: Node): { id: string; property: string; statements: string[] }[] {
  const out: { id: string; property: string; statements: string[] }[] = [];
  const parts: Node[] = [obj.produced_by, ...(obj.produced_by?.part ?? [])].filter(Boolean);
  for (const part of parts) {
    const statements = (part.referred_to_by ?? [])
      .filter((s: Node) => (s.language ?? []).some((l: Node) => sameTerm(l.id, AAT.english)))
      .map((s: Node) => String(s.content));
    for (const a of part.carried_out_by ?? []) out.push({ id: a.id, property: 'carried_out_by', statements });
    for (const assignment of part.assigned_by ?? []) {
      for (const a of assignment.assigned ?? []) {
        if (a.type === 'Person' || a.type === 'Group') {
          out.push({ id: a.id, property: assignment.assigned_property ?? 'unknown', statements });
        }
      }
    }
  }
  return out;
}

/** The record-level metadata license: a Right on the data.rijksmuseum.nl description. */
export function recordLicense(obj: Node): string | undefined {
  for (const s of obj.subject_of ?? []) {
    for (const right of s.subject_to ?? []) {
      const id = right.classified_as?.[0]?.id;
      if (id) return id;
    }
  }
  return undefined;
}

/** Image access points with the license statement attached to each. */
export function images(obj: Node): { url: string; license?: string; label?: string }[] {
  const out: { url: string; license?: string; label?: string }[] = [];
  for (const s of obj.subject_of ?? []) {
    for (const d of s.digitally_carried_by ?? []) {
      if (d.format === 'text/html' || (d.classified_as ?? []).some((c: Node) => sameTerm(c.id, AAT.webPage))) continue;
      const rights = (d.referred_to_by ?? [])[0];
      for (const ap of d.access_point ?? []) {
        out.push({ url: ap.id, license: rights?.content, label: rights?._label });
      }
    }
  }
  return out;
}

export function personNames(person: Node): string[] {
  const names: string[] = (person.identified_by ?? []).filter((n: Node) => n.type === 'Name').map((n: Node) => String(n.content));
  return [...new Set(names)];
}

export function createRijksmuseum(opts: { refresh?: boolean } = {}): SourceAdapter {
  const client = new SourceClient({
    source: 'rijksmuseum',
    minIntervalMs: 500,
    headers: { Accept: 'application/ld+json' },
    refresh: opts.refresh,
  });

  return {
    name: 'rijksmuseum',

    async *search(artist) {
      const seen = new Set<string>();
      for (const term of searchTerms(artist)) {
        let url: string | undefined = `${SEARCH}?creator=${encodeURIComponent(term)}`;
        for (let page = 1; url; page++) {
          const raw = await client.getJson('search', `creator-${term}-p${page}`, url);
          const body = raw.body as Node;
          for (const item of body.orderedItems ?? []) {
            const id = numericId(item.id);
            if (!seen.has(id)) {
              seen.add(id);
              yield id;
            }
          }
          url = body.next?.id;
        }
      }
    },

    fetch: (id) => client.getJson('objects', id, resolveUrl(id)),

    async fetchRelated(raw) {
      for (const a of productionAgents(raw.body as Node)) {
        if (a.id?.startsWith(PID)) await client.getJson('agents', numericId(a.id), resolveUrl(numericId(a.id)));
      }
    },

    toLinkedArt(raw): LinkedArtResult {
      const obj = raw.body as Node;
      const license = recordLicense(obj) ?? 'unstated';
      const fieldProv: Record<string, ReturnType<typeof provenanceFor>> = {};
      images(obj).forEach((img, i) => {
        if (img.license && img.license !== license) {
          fieldProv[`subject_of.digitally_carried_by[image ${i}]`] = provenanceFor(raw, img.license, img.label);
        }
      });
      // Already Linked Art: pass the record through untouched apart from provenance.
      return { record: withProvenance(obj, provenanceFor(raw, license), fieldProv), unmapped: {} };
    },

    async artistRefs(raw) {
      const obj = raw.body as Node;
      const refs: SourceArtistRef[] = [];
      for (const a of productionAgents(obj)) {
        const ref: SourceArtistRef = {
          source: 'rijksmuseum',
          recordId: raw.id,
          sourceAgentId: a.id,
          role: [a.property, ...a.statements].join(' | '),
          plainCreator: a.property === 'carried_out_by',
        };
        const agent = a.id?.startsWith(PID) ? await readCached('rijksmuseum', 'agents', numericId(a.id)) : null;
        if (agent) {
          const p = agent.body as Node;
          ref.name = personNames(p)[0];
          ref.birth = p.born?.timespan?.begin_of_the_begin;
          ref.death = p.died?.timespan?.begin_of_the_begin;
          const other: Record<string, string> = {};
          for (const eq of p.equivalent ?? []) {
            const id = String(eq.id);
            if (id.includes('wikidata.org/entity/')) ref.wikidata = qidFromUri(id);
            else if (id.includes('vocab.getty.edu/ulan/')) ref.ulan = id.split('/').at(-1);
            else if (id.includes('rkd.nl/artists/')) other.rkd = id.split('/').at(-1)!;
            else if (id.includes('viaf.org/viaf/')) other.viaf = id.split('/').at(-1)!;
            else other[id] = id;
          }
          if (Object.keys(other).length) ref.otherIds = other;
        }
        refs.push(ref);
      }
      return refs;
    },
  };
}
