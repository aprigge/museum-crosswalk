import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDir } from '../core/cache.js';
import type { SourceClient } from '../core/http.js';
import type { Concept } from '../authority/concepts.js';

export interface VocabEntry {
  qid: string;
  label: string;
  aliases: string[];
  /** Where it came from: the museums' own concepts, or the reviewed extension list. */
  origin: 'graph' | 'extension';
}

export interface ExtraConcept {
  label: string;
  mustDescribe: string;
}

export interface ResolvedExtra extends ExtraConcept {
  qid: string | null;
  wikidataLabel?: string;
  description?: string;
  candidates: { qid: string; label: string; description: string }[];
}

interface SearchResponse {
  search?: { id: string; label?: string; description?: string }[];
}

/**
 * Resolve one extension label on Wikidata: the first search hit whose English description
 * contains the expected word. No match means no concept: never a guess.
 */
export async function resolveExtra(client: SourceClient, c: ExtraConcept): Promise<ResolvedExtra> {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&limit=10&search=${encodeURIComponent(c.label)}`;
  const body = (await client.getJson('vocabulary', `search-${c.label}`, url)).body as SearchResponse;
  const candidates = (body.search ?? []).map((s) => ({ qid: s.id, label: s.label ?? '', description: s.description ?? '' }));
  const hit = candidates.find((s) => s.description.toLowerCase().includes(c.mustDescribe.toLowerCase()));
  return { ...c, qid: hit?.qid ?? null, wikidataLabel: hit?.label, description: hit?.description, candidates };
}

/** The enrichment vocabulary: every concept in the slice's graph plus the resolved extensions. */
export async function loadVocabulary(sliceId = 'paintings-1850-1900'): Promise<VocabEntry[]> {
  const concepts = JSON.parse(await readFile(join(dataDir(), 'concepts', `${sliceId}.json`), 'utf8')) as Record<string, Concept>;
  const byQid = new Map<string, VocabEntry>();
  for (const c of Object.values(concepts)) {
    if (!byQid.has(c.qid)) byQid.set(c.qid, { qid: c.qid, label: c.label, aliases: c.aliases.slice(0, 3), origin: 'graph' });
  }
  const resolved = JSON.parse(await readFile('alignments/ai-vocabulary.resolved.json', 'utf8').catch(() => '[]')) as ResolvedExtra[];
  for (const r of resolved) {
    if (r.qid && !byQid.has(r.qid)) byQid.set(r.qid, { qid: r.qid, label: r.wikidataLabel ?? r.label, aliases: [], origin: 'extension' });
  }
  return [...byQid.values()].sort((a, b) => a.label.localeCompare(b.label));
}
