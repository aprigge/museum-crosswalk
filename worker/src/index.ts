import Anthropic from '@anthropic-ai/sdk';
import { askRequest, AskSchema, isReadQuery, MAX_QUESTION } from '../../src/ai/ask.js';
import { summaryRequest, SummarySchema, type SummaryInput } from '../../src/ai/summary.js';
import { tableForSummary, unsupportedNumbers } from '../../site/js/answer-guard.js';
import { PROMPT_VERSION, SUMMARY_SYSTEM, SYSTEM } from './prompt.generated.js';

interface Env {
  ANTHROPIC_API_KEY: string;
  ALLOWED_ORIGINS: string;
  DAILY_CAP: string;
  /** Rate limiting binding; may be absent in local development. */
  ASK_LIMIT?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  ASK_COUNTS: KVNamespace;
}

type Headers = Record<string, string>;
const json = (body: unknown, status: number, headers: Headers) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

/** Call Claude with server-side refusal fallback; return the text, or an error response. */
async function callClaude(env: Env, params: object, cors: Headers): Promise<{ text: string; model: string } | Response> {
  try {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const msg = (await client.beta.messages.create({
      ...params,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    } as never)) as unknown as Anthropic.Message;
    if (msg.stop_reason === 'refusal') return json({ error: 'The model declined this question.' }, 422, cors);
    if (msg.stop_reason === 'max_tokens') return json({ error: 'The answer was cut off. Try a simpler question.' }, 502, cors);
    return { text: msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join(''), model: msg.model };
  } catch (err) {
    const status = err instanceof Anthropic.RateLimitError ? 429 : 502;
    return json({ error: status === 429 ? 'The model is busy. Try again shortly.' : 'Asking the model failed.' }, status, cors);
  }
}

/** /ask: question (and optionally a failed query and its error) -> one read-only SPARQL query. */
async function ask(body: Record<string, any>, env: Env, cors: Headers): Promise<Response> {
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question || question.length > MAX_QUESTION) return json({ error: `Ask a question of 1–${MAX_QUESTION} characters.` }, 400, cors);
  const retry =
    body.retry && typeof body.retry.sparql === 'string' && typeof body.retry.error === 'string'
      ? { sparql: body.retry.sparql.slice(0, 4000), error: body.retry.error.slice(0, 500) }
      : undefined;
  const out = await callClaude(env, askRequest(SYSTEM, question, retry), cors);
  if (out instanceof Response) return out;
  const parsed = AskSchema.safeParse(JSON.parse(out.text));
  if (!parsed.success) return json({ error: 'The model returned an unexpected answer.' }, 502, cors);
  const { sparql, explanation } = parsed.data;
  if (sparql && !isReadQuery(sparql)) return json({ error: 'The model wrote a query that would change data; refused.' }, 502, cors);
  return json({ sparql, explanation, promptVersion: PROMPT_VERSION, model: out.model }, 200, cors);
}

/**
 * /summarize: question + result rows -> one plain sentence. Sent only if every number in it
 * appears in the rows or is the row count; otherwise the page shows the table alone.
 */
async function summarize(body: Record<string, any>, env: Env, cors: Headers): Promise<Response> {
  const question = typeof body.question === 'string' ? body.question.trim().slice(0, MAX_QUESTION) : '';
  const columns = Array.isArray(body.columns) ? body.columns.map(String).slice(0, 12) : [];
  const rows = Array.isArray(body.rows) ? body.rows.filter(Array.isArray).map((r: unknown[]) => r.map(String)) : [];
  const rowCount = Number.isInteger(body.rowCount) && body.rowCount >= 0 ? body.rowCount : rows.length;
  if (!question || !columns.length) return json({ error: 'Send the question, columns and rows.' }, 400, cors);
  const table = { ...tableForSummary(columns, rows), rowCount };
  const input: SummaryInput = { question, explanation: String(body.explanation ?? '').slice(0, 600), table };
  const out = await callClaude(env, summaryRequest(SUMMARY_SYSTEM, input), cors);
  if (out instanceof Response) return out;
  const parsed = SummarySchema.safeParse(JSON.parse(out.text));
  if (!parsed.success) return json({ error: 'The model returned an unexpected answer.' }, 502, cors);
  const bad = unsupportedNumbers(parsed.data.sentence, table.rows, table.rowCount);
  if (bad.length) return json({ sentence: null, withheld: `numbers not in the rows: ${bad.join(', ')}` }, 200, cors);
  return json({ sentence: parsed.data.sentence, model: out.model }, 200, cors);
}

/** POST /ask and POST /summarize. Returns text; never runs queries; stores no questions. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin') ?? '';
    const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
    if (!allowed.includes(origin)) return json({ error: 'Origin not allowed' }, 403, {});
    const cors: Headers = { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const path = new URL(request.url).pathname;
    if (request.method !== 'POST' || !['/ask', '/summarize'].includes(path)) return json({ error: 'Not found' }, 404, cors);

    let body: Record<string, any>;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Send JSON.' }, 400, cors);
    }

    // Per visitor, then a daily ceiling across everyone: the spending cap.
    const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
    if (env.ASK_LIMIT && !(await env.ASK_LIMIT.limit({ key: ip })).success) {
      return json({ error: 'Too many questions in a minute. Try again shortly.' }, 429, cors);
    }
    const day = `count:${new Date().toISOString().slice(0, 10)}`;
    const today = Number((await env.ASK_COUNTS.get(day)) ?? '0');
    if (today >= Number(env.DAILY_CAP)) return json({ error: 'Today’s question limit for this demo is reached. Try tomorrow.' }, 429, cors);
    await env.ASK_COUNTS.put(day, String(today + 1), { expirationTtl: 3 * 86400 });

    return path === '/ask' ? ask(body, env, cors) : summarize(body, env, cors);
  },
};
