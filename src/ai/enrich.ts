import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import { jsonFormat, MODELS, type BatchRequest, type Prompt } from './client.js';
import type { CachedImage } from './images.js';
import type { VocabEntry } from './vocabulary.js';

export const GENRES = [
  'landscape painting', 'portrait', 'still life', 'marine art', 'genre art', 'cityscape',
  'interior', 'history painting', 'religious art', 'nude', 'other', 'unclear',
] as const;

export const EnrichmentSchema = z.object({
  subjects: z.array(z.object({
    conceptId: z.string(),
    confidence: z.number().min(0).max(1),
    evidence: z.string().max(300),
  })).max(20),
  genre: z.enum(GENRES),
  otherSubjects: z.array(z.string().max(80)).max(10),
});
export type Enrichment = z.infer<typeof EnrichmentSchema>;

export const ENRICHMENT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    subjects: {
      type: 'array',
      items: {
        type: 'object',
        properties: { conceptId: { type: 'string' }, confidence: { type: 'number' }, evidence: { type: 'string' } },
        required: ['conceptId', 'confidence', 'evidence'],
        additionalProperties: false,
      },
    },
    genre: { type: 'string', enum: [...GENRES] },
    otherSubjects: { type: 'array', items: { type: 'string' } },
  },
  required: ['subjects', 'genre', 'otherSubjects'],
  additionalProperties: false,
};

export interface EnrichItem {
  workId: string;
  title: string;
  begin?: number;
  museumName: string;
  existingSubjects: string[];
}

/**
 * The cached system prompt: the instructions plus the whole vocabulary, identical for every
 * painting, so all requests after the first read it from cache.
 */
export function enrichSystem(prompt: Prompt, vocab: VocabEntry[]): string {
  return `${prompt.text}${vocab.map((v) => `${v.qid}: ${v.label}${v.aliases.length ? ` (${v.aliases.join(', ')})` : ''}`).join('\n')}\n`;
}

export function enrichRequest(system: string, item: EnrichItem, image: CachedImage): BatchRequest['params'] {
  const catalogue = { title: item.title, date: item.begin ?? null, museum: item.museumName, existingSubjects: item.existingSubjects };
  const content: Anthropic.ContentBlockParam[] = [
    { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data.toString('base64') } },
    { type: 'text', text: `Catalogue data: ${JSON.stringify(catalogue)}` },
  ];
  return {
    model: MODELS.main,
    max_tokens: 8000,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'medium', format: jsonFormat(ENRICHMENT_JSON_SCHEMA) },
    messages: [{ role: 'user', content }],
  } as BatchRequest['params'];
}

/**
 * Keep only subjects whose ID is in the vocabulary: the model may not invent IDs. Anything
 * else is reported back so the run can say how often it happened.
 */
export function checkAgainstVocabulary(e: Enrichment, vocab: Map<string, VocabEntry>) {
  const kept = e.subjects.filter((s) => vocab.has(s.conceptId));
  const unknownIds = e.subjects.filter((s) => !vocab.has(s.conceptId)).map((s) => s.conceptId);
  return { ...e, subjects: kept, unknownIds };
}
