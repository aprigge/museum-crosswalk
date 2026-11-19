import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import { jsonFormat, MODELS, type BatchRequest, type Prompt } from './client.js';
import type { CachedImage } from './images.js';

export const JudgmentSchema = z.object({
  relevant: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(400),
});
export type Judgment = z.infer<typeof JudgmentSchema>;

/** The same schema as JSON Schema for structured outputs (strict: no extra fields). */
export const JUDGMENT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    relevant: { type: 'boolean' },
    confidence: { type: 'number' },
    reason: { type: 'string' },
  },
  required: ['relevant', 'confidence', 'reason'],
  additionalProperties: false,
};

export interface JudgeItem {
  queryId: string;
  query: string;
  rule: string;
  workId: string;
  title: string;
  artists: string[];
  begin?: number;
  museumName: string;
  styles: string[];
}

/** Batch custom_ids allow only [A-Za-z0-9_-], up to 64 characters. */
export const judgeKey = (i: Pick<JudgeItem, 'queryId' | 'workId'>) => `${i.queryId}-${i.workId}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);

/**
 * One judging request. The system prompt is identical for every item and cached; the query,
 * the catalogue data and the image follow it. Effort is low: a short visual decision per item.
 */
export function judgeRequest(prompt: Prompt, item: JudgeItem, image: CachedImage | null): BatchRequest['params'] {
  const catalogue = {
    title: item.title,
    artists: item.artists,
    date: item.begin ?? null,
    museum: item.museumName,
    stylesOrMovements: item.styles,
  };
  const content: Anthropic.ContentBlockParam[] = [];
  if (image) content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data.toString('base64') } });
  else content.push({ type: 'text', text: 'No openly licensed image is available for this painting; judge from the catalogue data only.' });
  content.push({
    type: 'text',
    text: `Query: ${JSON.stringify(item.query)}\nRelevant means: ${item.rule}\nCatalogue data: ${JSON.stringify(catalogue)}`,
  });
  return {
    model: MODELS.judge,
    max_tokens: 4000,
    system: [{ type: 'text', text: prompt.text, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'low', format: jsonFormat(JUDGMENT_JSON_SCHEMA) },
    messages: [{ role: 'user', content }],
  } as BatchRequest['params'];
}
