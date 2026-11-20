import { z } from 'zod';
import { jsonFormat, MODELS } from './models.js';

// The one-sentence answer above Ask results. Shared by the Worker and any eval, like ask.ts.

export const SummarySchema = z.object({ sentence: z.string().min(1).max(500) });

export const SUMMARY_JSON_SCHEMA = {
  type: 'object',
  properties: { sentence: { type: 'string' } },
  required: ['sentence'],
  additionalProperties: false,
};

export interface SummaryInput {
  question: string;
  explanation: string;
  table: { columns: string[]; rows: string[][]; rowCount: number };
}

/** Low effort: restating rows needs little reasoning, and the guard checks the numbers. */
export function summaryRequest(system: string, input: SummaryInput) {
  return {
    model: MODELS.main,
    max_tokens: 2000,
    system: [{ type: 'text' as const, text: system, cache_control: { type: 'ephemeral' as const } }],
    output_config: { effort: 'low' as const, format: jsonFormat(SUMMARY_JSON_SCHEMA) },
    messages: [{ role: 'user' as const, content: JSON.stringify(input) }],
  };
}
