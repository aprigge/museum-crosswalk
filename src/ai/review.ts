import { z } from 'zod';
import { jsonFormat, MODELS, type BatchRequest, type Prompt } from './client.js';

export const DECISIONS = ['merge', 'keep-separate', 'needs-human'] as const;

export const ReviewSchema = z.object({
  decision: z.enum(DECISIONS),
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.object({ field: z.string().max(60), point: z.string().max(300) })).min(1).max(6),
});
export type ReviewProposal = z.infer<typeof ReviewSchema>;

export const REVIEW_JSON_SCHEMA = {
  type: 'object',
  properties: {
    decision: { type: 'string', enum: [...DECISIONS] },
    confidence: { type: 'number' },
    reasons: {
      type: 'array',
      items: {
        type: 'object',
        properties: { field: { type: 'string' }, point: { type: 'string' } },
        required: ['field', 'point'],
        additionalProperties: false,
      },
    },
  },
  required: ['decision', 'confidence', 'reasons'],
  additionalProperties: false,
};

/** Everything a cataloguer would look at for one museum artist and one Wikidata candidate. */
export interface ReviewCase {
  key: string; // e.g. aic-36351: the museum and its own agent ID
  museum: { source: string; agentId: string; name?: string; birthYear?: string; deathYear?: string; ids: Record<string, string> };
  works: { title: string; date?: number }[];
  candidate: {
    qid: string;
    label: string;
    description?: string;
    occupations: string[];
    birthYear?: string;
    deathYear?: string;
    movements: string[];
    externalIds: Record<string, string[]>;
  };
  matcherEvidence: string;
  reviewReason: string;
}

/** Batch-safe key: museum and agent ID. */
export const reviewKey = (source: string, agentId: string) =>
  `${source}-${agentId.split('/').at(-1)}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);

export function reviewRequest(prompt: Prompt, c: ReviewCase): BatchRequest['params'] {
  const { key, ...data } = c;
  return {
    model: MODELS.main,
    max_tokens: 8000,
    system: [{ type: 'text', text: prompt.text, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'high', format: jsonFormat(REVIEW_JSON_SCHEMA) },
    messages: [{ role: 'user', content: `Case ${key}:\n${JSON.stringify(data, null, 2)}` }],
  } as BatchRequest['params'];
}
