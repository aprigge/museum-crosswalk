import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDir, readJson, writeJson } from '../core/cache.js';
import { SLICES } from '../core/types.js';
import { resolveConcepts } from '../authority/concepts.js';
import { newWikidataClient } from '../authority/wikidata.js';
import { selectSources } from '../sources/index.js';
import { cliArgs, main } from './common.js';

type Node = Record<string, any>;

/** Concept URIs a converted record and its VisualItems use: styles, subjects, depicted types and places. */
export function conceptUris(record: Node, related: Node[]): string[] {
  const out: string[] = [];
  const add = (t: Node) => {
    if (t?.id) out.push(String(t.id));
    for (const e of t?.equivalent ?? []) if (e?.id) out.push(String(e.id));
  };
  for (const c of record.classified_as ?? []) if ((c.classified_as ?? []).some((m: Node) => /300015646$/.test(m.id ?? ''))) add(c);
  for (const v of related) {
    for (const key of ['about', 'represents_instance_of_type', 'represents']) for (const t of v[key] ?? []) add(t);
  }
  return out.filter((u) => /vocab\.getty\.edu\/aat\/|iconclass\.org\/|wikidata\.org\/entity\//.test(u));
}

main(async () => {
  const args = cliArgs();
  const slice = SLICES[args.slice ?? 'paintings-1850-1900'];
  if (!slice) throw new Error(`Unknown slice "${args.slice}"`);
  const works = await readJson<Record<string, string[]>>(join(dataDir(), 'reconcile', slice.id, 'works.json'));

  const bySource: Record<string, number> = {};
  const uris = new Set<string>();
  for (const adapter of selectSources(args.source)) {
    const dir = join(dataDir(), 'linked-art', adapter.name);
    const relatedFiles = new Set(await readdir(join(dir, 'related')).catch(() => [] as string[]));
    let n = 0;
    for (const id of works[adapter.name] ?? []) {
      const record = await readJson<Node>(join(dir, `${id}.json`));
      const related: Node[] = [];
      for (const v of record.shows ?? []) {
        const f = `${String(v.id).split('/').at(-1)}.json`;
        if (relatedFiles.has(f)) related.push(await readJson<Node>(join(dir, 'related', f)));
      }
      const found = conceptUris(record, related);
      if (found.length) n++;
      found.forEach((u) => uris.add(u));
    }
    bySource[adapter.name] = n;
  }

  const concepts = await resolveConcepts(newWikidataClient(args.refresh), [...uris]);
  await writeJson(join(dataDir(), 'concepts', `${slice.id}.json`), Object.fromEntries(concepts));
  const matched = [...concepts.values()];
  console.log(`concept URIs: ${uris.size}; resolved to Wikidata: ${matched.length} (${matched.filter((c) => c.match === 'broad').length} broad)`);
  for (const [s, n] of Object.entries(bySource)) console.log(`${s}: ${n} of ${works[s]?.length ?? 0} works carry concepts`);
});
