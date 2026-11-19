import { join } from 'node:path';
import { cacheKey, dataDir, listCached, writeJson } from '../core/cache.js';
import { validateJsonLd, validateSchema } from '../linkedart/validate.js';
import { selectSources } from '../sources/index.js';
import { cliArgs, main } from './common.js';

main(async () => {
  const args = cliArgs();
  for (const adapter of selectSources(args.source)) {
    const outDir = join(dataDir(), 'linked-art', adapter.name);
    const validation: Record<string, { schema: string[]; jsonld: string[] }> = {};
    const unmapped: Record<string, Record<string, unknown>> = {};
    const raws = await listCached(adapter.name, 'objects');
    await adapter.prepareTransform?.();
    for (const raw of raws) {
      const result = adapter.toLinkedArt(raw);
      await writeJson(join(outDir, `${cacheKey(raw.id)}.json`), result.record);
      // Records the object points to (e.g. its VisualItem), named by the last segment of their id.
      for (const rel of result.related ?? []) {
        await writeJson(join(outDir, 'related', `${String(rel.id).split('/').at(-1)}.json`), rel);
      }
      validation[raw.id] = { schema: validateSchema(result.record), jsonld: await validateJsonLd(result.record) };
      if (Object.keys(result.unmapped).length) unmapped[raw.id] = result.unmapped;
    }
    await writeJson(join(outDir, '_validation.json'), validation);
    await writeJson(join(outDir, '_unmapped.json'), unmapped);
    const invalid = Object.values(validation).filter((v) => v.schema.length || v.jsonld.length).length;
    console.log(`${adapter.name}: ${raws.length} records converted, ${invalid} with validation problems`);
  }
});
