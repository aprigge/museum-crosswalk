import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import { jsonFormat, MODELS } from './models.js';

// Shared by the eval (Node) and the Worker: the same request, so the eval measures what visitors get.

export const AskSchema = z.object({
  sparql: z.string().max(4000),
  explanation: z.string().max(600),
});
export type AskAnswer = z.infer<typeof AskSchema>;

export const ASK_JSON_SCHEMA = {
  type: 'object',
  properties: { sparql: { type: 'string' }, explanation: { type: 'string' } },
  required: ['sparql', 'explanation'],
  additionalProperties: false,
};

export const MAX_QUESTION = 300;

/** The cached system prompt: instructions plus the schema card. */
export const askSystem = (instructions: string, schemaCard: string) => `${instructions}\n${schemaCard}`;

/**
 * One question, optionally with a previous attempt and its error, so the model can fix a query
 * that didn't parse (one retry, as the site does).
 */
export function askRequest(system: string, question: string, retry?: { sparql: string; error: string }) {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: `Question: ${JSON.stringify(question.slice(0, MAX_QUESTION))}` }];
  if (retry) {
    messages.push(
      { role: 'assistant', content: JSON.stringify({ sparql: retry.sparql, explanation: '' }) },
      { role: 'user', content: `That query failed: ${retry.error.slice(0, 500)}\nReturn a corrected query.` },
    );
  }
  return {
    model: MODELS.main,
    max_tokens: 8000,
    system: [{ type: 'text' as const, text: system, cache_control: { type: 'ephemeral' as const } }],
    output_config: { effort: 'medium' as const, format: jsonFormat(ASK_JSON_SCHEMA) },
    messages,
  };
}

// The query guards are plain JS shared with the site and the Worker.
export { ASK_PREFIXES, isReadQuery, withPrefixes } from '../../site/js/sparql.js';
