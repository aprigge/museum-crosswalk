import Anthropic from '@anthropic-ai/sdk';
import { askRequest, AskSchema, isReadQuery, MAX_QUESTION } from '../../src/ai/ask.js';
import { PROMPT_VERSION, SYSTEM } from './prompt.generated.js';

interface Env {
  ANTHROPIC_API_KEY: string;
  ALLOWED_ORIGINS: string;
  DAILY_CAP: string;
  /** Rate limiting binding; may be absent in local development. */
  ASK_LIMIT?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  ASK_COUNTS: KVNamespace;
}

const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

/**
 * POST /ask { question, retry?: { sparql, error } } -> { sparql, explanation, promptVersion }.
 * Returns a query; never runs one. Questions are not stored: only a per-day count is kept.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin') ?? '';
    const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
    const cors: Record<string, string> = allowed.includes(origin)
      ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }
      : {};
    if (!cors['Access-Control-Allow-Origin']) return json({ error: 'Origin not allowed' }, 403, {});
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/ask') return json({ error: 'Not found' }, 404, cors);

    let body: { question?: unknown; retry?: { sparql?: unknown; error?: unknown } };
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Send JSON: { "question": "..." }' }, 400, cors);
    }
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    if (!question || question.length > MAX_QUESTION) return json({ error: `Ask a question of 1–${MAX_QUESTION} characters.` }, 400, cors);
    const retry =
      body.retry && typeof body.retry.sparql === 'string' && typeof body.retry.error === 'string'
        ? { sparql: body.retry.sparql.slice(0, 4000), error: body.retry.error.slice(0, 500) }
        : undefined;

    // Per visitor, then a daily ceiling across everyone: the spending cap.
    const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
    if (env.ASK_LIMIT && !(await env.ASK_LIMIT.limit({ key: ip })).success) {
      return json({ error: 'Too many questions in a minute. Try again shortly.' }, 429, cors);
    }
    const day = `count:${new Date().toISOString().slice(0, 10)}`;
    const today = Number((await env.ASK_COUNTS.get(day)) ?? '0');
    if (today >= Number(env.DAILY_CAP)) return json({ error: 'Today’s question limit for this demo is reached. Try tomorrow.' }, 429, cors);
    await env.ASK_COUNTS.put(day, String(today + 1), { expirationTtl: 3 * 86400 });

    try {
      const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
      const msg = (await client.beta.messages.create({
        ...askRequest(SYSTEM, question, retry),
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      } as never)) as unknown as Anthropic.Message;
      if (msg.stop_reason === 'refusal') return json({ error: 'The model declined this question.' }, 422, cors);
      if (msg.stop_reason === 'max_tokens') return json({ error: 'The answer was cut off. Try a simpler question.' }, 502, cors);
      const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      const parsed = AskSchema.safeParse(JSON.parse(text));
      if (!parsed.success) return json({ error: 'The model returned an unexpected answer.' }, 502, cors);
      const { sparql, explanation } = parsed.data;
      if (sparql && !isReadQuery(sparql)) return json({ error: 'The model wrote a query that would change data; refused.' }, 502, cors);
      return json({ sparql, explanation, promptVersion: PROMPT_VERSION, model: msg.model }, 200, cors);
    } catch (err) {
      const status = err instanceof Anthropic.RateLimitError ? 429 : 502;
      return json({ error: status === 429 ? 'The model is busy. Try again shortly.' : 'Asking the model failed.' }, status, cors);
    }
  },
};
