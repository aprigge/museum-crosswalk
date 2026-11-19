import { readFile, writeFile } from 'node:fs/promises';
import { newWikidataClient } from '../authority/wikidata.js';
import { loadVocabulary, resolveExtra, type ExtraConcept } from '../ai/vocabulary.js';
import { cliArgs, main } from './common.js';

// Resolve the extension concepts on Wikidata and write them for review.
main(async () => {
  const args = cliArgs();
  const { concepts } = JSON.parse(await readFile('alignments/ai-vocabulary-extra.json', 'utf8')) as { concepts: ExtraConcept[] };
  const client = newWikidataClient(args.refresh);
  const resolved = [];
  for (const c of concepts) resolved.push(await resolveExtra(client, c));
  // Keep only what a reviewer needs: the chosen item and, for misses, what was found.
  const out = resolved.map(({ candidates, ...r }) => (r.qid ? r : { ...r, candidates: candidates.slice(0, 5) }));
  await writeFile('alignments/ai-vocabulary.resolved.json', JSON.stringify(out, null, 2) + '\n');
  for (const r of resolved) console.log(`${r.label.padEnd(16)} ${r.qid ? `${r.qid.padEnd(10)} ${r.wikidataLabel}: ${r.description}` : `UNRESOLVED (${r.candidates.length} candidates)`}`);
  const vocab = await loadVocabulary();
  console.log(`vocabulary: ${vocab.length} concepts (${vocab.filter((v) => v.origin === 'extension').length} from the extension)`);
});
