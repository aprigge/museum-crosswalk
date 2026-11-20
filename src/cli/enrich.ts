import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { dataDir } from '../core/cache.js';
import { anthropic, costUsd, loadPrompt, MODELS, readRecord, runBatch, toRecord, writeRecord, type AiRecord, type Prompt } from '../ai/client.js';
import { checkAgainstVocabulary, enrichRequest, enrichSystem, EnrichmentSchema, type EnrichItem, type Enrichment } from '../ai/enrich.js';
import { getImage, type CachedImage } from '../ai/images.js';
import { loadEnrichVocabulary } from '../ai/vocabulary.js';
import type { SearchDoc } from '../search/build.js';
import { main } from './common.js';

// npm run enrich -- --dry-run      what would run, and the estimated cost
// npm run enrich -- --sample 20    tag a mixed sample one call at a time, printed for review
// npm run enrich                   tag every remaining painting with an open image, as one batch

const SLICE = 'paintings-1850-1900';

/** A larger image than the search thumbnail where the source serves sizes: more to look at. */
const imageUrl = (thumb: string) => thumb.replace('/full/400,/', '/full/843,/');

/**
 * A sample that tests what enrichment is for: Rijksmuseum works with no subjects first (and
 * its Monet, catalogued without a landscape code), then the Met and AIC, about a third each.
 */
function pickSample(docs: SearchDoc[], n: number): SearchDoc[] {
  const per = Math.ceil(n / 3);
  const rijks = docs.filter((d) => d.museum === 'rijksmuseum');
  const monet = rijks.filter((d) => d.artists.includes('Claude Monet'));
  const bare = rijks.filter((d) => !d.subjects.length && !monet.includes(d));
  const pick = [...monet, ...bare.slice(0, per - monet.length)];
  pick.push(...docs.filter((d) => d.museum === 'met').slice(0, per));
  pick.push(...docs.filter((d) => d.museum === 'aic').slice(0, n - pick.length));
  return pick.slice(0, n);
}

main(async () => {
  const dryRun = process.argv.includes('--dry-run');
  const sampleArg = process.argv.indexOf('--sample');
  const sample = sampleArg > 0 ? Number(process.argv[sampleArg + 1]) : undefined;

  const docs = (JSON.parse(await readFile(join(dataDir(), 'graph', SLICE, 'search-docs.json'), 'utf8')) as SearchDoc[]).filter((d) => d.thumb);
  const vocab = await loadEnrichVocabulary(SLICE);
  const vocabById = new Map(vocab.map((v) => [v.qid, v]));
  const base = await loadPrompt('enrich');
  const system = enrichSystem(base, vocab);
  // The version covers the instructions and the vocabulary: changing either re-runs the tagging.
  const prompt: Prompt = { ...base, version: createHash('sha1').update(system).digest('hex').slice(0, 10) };

  const pending: SearchDoc[] = [];
  for (const d of docs) if (!(await readRecord<Enrichment>('enrich', d.id, prompt.version))?.output) pending.push(d);
  // Measured on the judge batch and scaled to Opus with an 843 px image: ~1,200 fresh input
  // tokens, ~5,000 cached, ~700 output (incl. thinking) per painting.
  const per = (batch: boolean) =>
    costUsd(MODELS.main, { input_tokens: 1200, output_tokens: 700, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 } as never, batch);
  console.log(`${docs.length} paintings with an open image; ${pending.length} not yet tagged with prompt ${prompt.version} (${vocab.length} concepts).`);
  console.log(`Estimated cost: about $${(per(true) * pending.length).toFixed(2)} as a batch; a ${sample ?? 20}-painting sample one by one about $${(per(false) * (sample ?? 20)).toFixed(2)}.`);
  if (dryRun || !pending.length) return;

  const items = sample ? pickSample(pending, sample) : pending;
  const images = new Map<string, CachedImage>();
  const skipped: string[] = [];
  for (const d of items) {
    try {
      images.set(d.id, await getImage(imageUrl(d.thumb!)));
    } catch (err) {
      skipped.push(`${d.id}: ${(err as Error).message}`);
    }
  }
  const toItem = (d: SearchDoc): EnrichItem => ({ workId: d.id, title: d.title, begin: d.begin, museumName: d.museumName, existingSubjects: d.subjects.slice(0, 15) });
  const runnable = items.filter((d) => images.has(d.id));

  let spent = 0;
  const report = (d: SearchDoc, rec: AiRecord<Enrichment>) => {
    if (!rec.output) return console.log(`✗ ${d.title} (${d.museumName}): ${rec.error}`);
    const checked = checkAgainstVocabulary(rec.output, vocabById);
    const tags = checked.subjects.map((s) => `${vocabById.get(s.conceptId)!.label} ${s.confidence.toFixed(2)}`).join(', ');
    console.log(`\n${d.title} (${d.museumName}, ${d.begin ?? '?'})\n  museum subjects: ${d.subjects.slice(0, 6).join(', ') || '(none)'}\n  genre: ${checked.genre}\n  AI subjects: ${tags || '(none)'}` +
      (checked.otherSubjects.length ? `\n  outside vocabulary: ${checked.otherSubjects.join(', ')}` : '') +
      (checked.unknownIds.length ? `\n  REJECTED unknown IDs: ${checked.unknownIds.join(', ')}` : ''));
  };

  if (sample) {
    for (const d of runnable) {
      const msg = (await anthropic().messages.create(enrichRequest(system, toItem(d), images.get(d.id)!) as never)) as Anthropic.Message;
      const rec = toRecord('enrich', d.id, prompt, msg, EnrichmentSchema);
      await writeRecord(rec, prompt.version);
      spent += costUsd(rec.model, rec.usage, false);
      report(d, rec);
    }
  } else {
    const results = await runBatch(runnable.map((d) => ({ custom_id: d.id, params: enrichRequest(system, toItem(d), images.get(d.id)!) })));
    const failures = new Map<string, number>();
    for (const d of runnable) {
      const r = results.get(d.id);
      const rec: AiRecord<Enrichment> = !r || 'error' in r
        ? { task: 'enrich', key: d.id, model: MODELS.main, promptVersion: prompt.version, createdAt: new Date().toISOString(), stopReason: null, usage: null, output: null, error: r && 'error' in r ? r.error : 'missing from batch' }
        : toRecord('enrich', d.id, prompt, r, EnrichmentSchema);
      await writeRecord(rec, prompt.version);
      spent += costUsd(rec.model, rec.usage, true);
      if (rec.error) failures.set(rec.error.split(':')[0]!, (failures.get(rec.error.split(':')[0]!) ?? 0) + 1);
    }
    // Refusals, cut-off and invalid answers are recorded and left out of the graph; say how many.
    if (failures.size) console.log(`Not tagged: ${[...failures].map(([k, n]) => `${n} ${k}`).join(', ')}`);
  }
  if (skipped.length) console.log(`\nSkipped (image not fetched): ${skipped.join('; ')}`);
  await writeFile(join(dataDir(), 'ai', 'enrich', prompt.version, '_run.json'), JSON.stringify({ prompt: prompt.version, vocabulary: vocab.length, items: runnable.length, skipped, spentUsd: spent, at: new Date().toISOString() }, null, 2));
  console.log(`\nSpent about $${spent.toFixed(3)} on ${runnable.length} paintings.`);
});
