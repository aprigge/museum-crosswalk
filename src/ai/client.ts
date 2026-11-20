import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import { dataDir } from '../core/cache.js';

export { MODELS, jsonFormat } from './models.js';
import { MODELS } from './models.js';

let client: Anthropic | null = null;
/** Credentials resolve the SDK's usual way (ANTHROPIC_API_KEY from .env, or an `ant` profile). */
export function anthropic(): Anthropic {
  client ??= new Anthropic();
  return client;
}

export interface Prompt {
  name: string;
  text: string;
  /** Short hash of the prompt text: part of every cache key, so editing a prompt re-runs it. */
  version: string;
}

export async function loadPrompt(name: string): Promise<Prompt> {
  const text = await readFile(join('prompts', `${name}.md`), 'utf8');
  return { name, text, version: createHash('sha1').update(text).digest('hex').slice(0, 10) };
}

/** What every AI result records about how it was made. */
export interface AiRecord<T> {
  task: string;
  key: string;
  model: string;
  promptVersion: string;
  createdAt: string;
  stopReason: string | null;
  usage: Anthropic.Usage | null;
  /** The validated output; null when the call refused, was cut off, or failed validation. */
  output: T | null;
  error?: string;
}

const recordPath = (task: string, key: string, version: string) => join(dataDir(), 'ai', task, version, `${key}.json`);

export async function readRecord<T>(task: string, key: string, version: string): Promise<AiRecord<T> | null> {
  try {
    return JSON.parse(await readFile(recordPath(task, key, version), 'utf8')) as AiRecord<T>;
  } catch {
    return null;
  }
}

export async function writeRecord<T>(record: AiRecord<T>, version: string): Promise<void> {
  const p = recordPath(record.task, record.key, version);
  await mkdir(join(p, '..'), { recursive: true });
  await writeFile(p, JSON.stringify(record, null, 2));
}


/**
 * Turn a finished message into a validated result. Checks stop_reason before reading content,
 * parses the text as JSON, and validates it with Zod: nothing unvalidated reaches the graph.
 */
export function toRecord<T>(
  task: string,
  key: string,
  prompt: Prompt,
  message: Pick<Anthropic.Message, 'model' | 'stop_reason' | 'usage' | 'content'>,
  validator: z.ZodType<T>,
): AiRecord<T> {
  const base = {
    task,
    key,
    model: message.model,
    promptVersion: prompt.version,
    createdAt: new Date().toISOString(),
    stopReason: message.stop_reason,
    usage: message.usage,
  };
  if (message.stop_reason === 'refusal') return { ...base, output: null, error: 'refusal' };
  if (message.stop_reason === 'max_tokens') return { ...base, output: null, error: 'max_tokens' };
  const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  try {
    const parsed = validator.safeParse(JSON.parse(text));
    return parsed.success ? { ...base, output: parsed.data } : { ...base, output: null, error: `invalid: ${parsed.error.message.slice(0, 300)}` };
  } catch {
    return { ...base, output: null, error: 'not JSON' };
  }
}

export type BatchRequest = Anthropic.Messages.Batches.BatchCreateParams.Request;

/**
 * Run requests through the Message Batches API (half price), wait for it to end, and hand
 * back each finished message by custom_id. Results arrive in any order: keyed, never positional.
 */
export async function runBatch(
  requests: BatchRequest[],
  onProgress: (msg: string) => void = console.log,
  chunkSize = 100,
): Promise<Map<string, Anthropic.Message | { error: string }>> {
  const api = anthropic();
  // Requests with images are large: one upload of ~1,000 of them (~150 MB) dropped the
  // connection, so submit in chunks, then wait for all of them.
  const ids: string[] = [];
  for (let i = 0; i < requests.length; i += chunkSize) {
    const batch = await api.messages.batches.create({ requests: requests.slice(i, i + chunkSize) }, { timeout: 10 * 60_000 });
    ids.push(batch.id);
    onProgress(`batch ${batch.id}: requests ${i + 1}–${Math.min(i + chunkSize, requests.length)} of ${requests.length} submitted`);
  }
  const out = new Map<string, Anthropic.Message | { error: string }>();
  for (const id of ids) {
    let status = await api.messages.batches.retrieve(id);
    while (status.processing_status !== 'ended') {
      await new Promise((r) => setTimeout(r, 30_000));
      status = await api.messages.batches.retrieve(id);
      const c = status.request_counts;
      onProgress(`batch ${id}: ${c.succeeded} done, ${c.processing} processing, ${c.errored} errored`);
    }
    for await (const r of await api.messages.batches.results(id)) {
      if (r.result.type === 'succeeded') out.set(r.custom_id, r.result.message);
      else out.set(r.custom_id, { error: r.result.type === 'errored' ? `errored: ${JSON.stringify(r.result.error).slice(0, 300)}` : r.result.type });
    }
  }
  return out;
}

/** Approximate cost from usage, for reporting (cache writes 1.25x input, reads 0.1x; batches half). */
const PRICES: Record<string, { in: number; out: number }> = {
  'claude-opus-5-5': { in: 4, out: 20 },
  'claude-sonnet-5-5': { in: 2, out: 10 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5 },
};
export function costUsd(model: string, u: Anthropic.Usage | null, batch: boolean): number {
  const p = PRICES[model] ?? Object.entries(PRICES).find(([k]) => model.startsWith(k))?.[1];
  if (!p || !u) return 0;
  const input = u.input_tokens + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1;
  return ((input * p.in + u.output_tokens * p.out) / 1e6) * (batch ? 0.5 : 1);
}
