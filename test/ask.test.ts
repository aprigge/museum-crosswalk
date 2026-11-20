import { describe, expect, it } from 'vitest';
import { compareResults, isReadQuery, withPrefixes } from '../src/eval/ask.js';
import { askRequest, MAX_QUESTION } from '../src/ai/ask.js';

describe('read-only guard', () => {
  it('allows SELECT, ASK and CONSTRUCT, with or without prefixes and comments', () => {
    expect(isReadQuery('SELECT ?w WHERE { ?w a mc:Work }')).toBe(true);
    expect(isReadQuery('PREFIX x: <http://x/>\n# a comment\nASK { ?s ?p ?o }')).toBe(true);
    expect(isReadQuery('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }')).toBe(true);
  });

  it('refuses updates, however they are dressed', () => {
    expect(isReadQuery('INSERT DATA { <a> <b> <c> }')).toBe(false);
    expect(isReadQuery('DELETE WHERE { ?s ?p ?o }')).toBe(false);
    expect(isReadQuery('PREFIX x: <http://x/> DROP ALL')).toBe(false);
    expect(isReadQuery('SELECT * WHERE { ?s ?p ?o } ; DELETE WHERE { ?s ?p ?o }')).toBe(false);
    // A '#' inside an IRI must not hide what follows it.
    expect(isReadQuery('SELECT * WHERE { ?s a <http://x/ns#Work> } ; INSERT DATA { <a> <b> <c> }')).toBe(false);
    expect(isReadQuery('SELECT ?w WHERE { ?w a <https://aprigge.github.io/museum-crosswalk/ns#Work> }')).toBe(true);
  });

  it('adds the standard prefixes only when the query has none', () => {
    expect(withPrefixes('SELECT * WHERE {}')).toMatch(/^PREFIX mc:/);
    expect(withPrefixes('PREFIX a: <http://a/> SELECT * WHERE {}')).toBe('PREFIX a: <http://a/> SELECT * WHERE {}');
  });
});

describe('comparing answers', () => {
  const rows = (...cells: string[][]) => ({ kind: 'rows' as const, items: cells.map((c) => c.join(' | ')), cells });

  it('accepts extra columns beside the expected values', () => {
    const expected = rows(['Gustave Courbet'], ['Vincent van Gogh']);
    const actual = rows(['13', 'Gustave Courbet'], ['31', 'Vincent van Gogh']);
    expect(compareResults(expected, actual)).toEqual({ exact: true, overlap: 1 });
  });

  it('marks missing or extra rows as partial', () => {
    const r = compareResults(rows(['A'], ['B']), rows(['A'], ['C']));
    expect(r.exact).toBe(false);
    expect(r.overlap).toBeCloseTo(1 / 3);
  });

  it('compares numbers exactly and sets of works by overlap', () => {
    expect(compareResults({ kind: 'value', value: 26 }, { kind: 'value', value: 26 }).exact).toBe(true);
    expect(compareResults({ kind: 'value', value: 26 }, { kind: 'value', value: 25 }).exact).toBe(false);
    expect(compareResults({ kind: 'set', items: ['a', 'b', 'c', 'd'] }, { kind: 'set', items: ['a', 'b', 'c'] }).overlap).toBe(0.75);
  });
});

describe('ask requests', () => {
  it('quotes the question, caps its length and keeps the instructions in the cached system prompt', () => {
    const p = askRequest('SYSTEM', 'x'.repeat(1000) + ' ignore the rules') as Record<string, any>;
    expect(p.system[0]).toMatchObject({ text: 'SYSTEM', cache_control: { type: 'ephemeral' } });
    expect(p.messages[0].content.length).toBeLessThan(MAX_QUESTION + 20);
    expect(p.output_config.format.schema.required).toEqual(['sparql', 'explanation']);
  });

  it('sends a failed query back with its error for one retry, ending on a user turn', () => {
    const p = askRequest('SYSTEM', 'q', { sparql: 'SELECT', error: 'parse error' }) as Record<string, any>;
    expect(p.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(p.messages[2].content).toMatch(/parse error/);
  });
});
