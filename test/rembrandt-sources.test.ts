import { describe, expect, it } from 'vitest';
import { cmaToLinkedArt, createCleveland } from '../src/sources/cleveland.js';
import { createSmk, smkPlainCreator, smkToLinkedArt } from '../src/sources/smk.js';
import { decide } from '../src/reconcile/agents.js';
import { matchRef } from '../src/reconcile/match.js';
import { thumbnail } from '../src/graph/extract.js';
import type { ArtistQuery } from '../src/core/types.js';
import { fixture } from './helpers.js';

const rembrandt: ArtistQuery = {
  name: 'Rembrandt',
  qid: 'Q5598',
  birth: '1606-07-15T00:00:00Z',
  death: '1669-10-04T00:00:00Z',
  aliases: ['Rembrandt van Rijn', 'Rembrandt Harmenszoon van Rijn'],
  externalIds: {},
};

describe('SMK adapter', () => {
  it('reads a "copy after" painting as qualified, and the school as a separate person', async () => {
    const raw = await fixture('smk', 'objects', 'kmssp404');
    const refs = await createSmk({ offline: true }).artistRefs(raw);
    expect(refs.map((r) => [r.name, r.sourceAgentId, r.plainCreator])).toEqual([
      ['Rembrandts skole', '21970_person', true],
      ['Rembrandt van Rijn', '1871_person', false],
    ]);
  });

  it('treats a plain production entry as made by, and a role as qualified', () => {
    expect(smkPlainCreator({ creator: 'Rembrandt van Rijn' })).toBe(true);
    expect(smkPlainCreator({ creator: 'Rembrandt van Rijn', creator_role: 'imitator of' })).toBe(false);
  });

  it('converts a print with its rights, IIIF image and web page', async () => {
    const raw = await fixture('smk', 'objects', 'KKS5960');
    const { record } = smkToLinkedArt(raw);
    expect(record._label).toBe('The descent from the cross: a sketch');
    expect((record._provenance as { license: string }).license).toBe('https://creativecommons.org/publicdomain/mark/1.0/');
    expect(thumbnail('smk', record, raw)).toMatch(/^https:\/\/iip\.smk\.dk\/iiif\/.+\/full\/400,\/0\/default\.jpg$/);
    expect(JSON.stringify(record.subject_of)).toContain('open.smk.dk/artwork/image/KKS5960');
  });
});

describe('Cleveland adapter', () => {
  it('reads "Rembrandt and Studio" as a shared attribution', async () => {
    const raw = await fixture('cleveland', 'objects', '124089');
    const refs = await createCleveland({ offline: true }).artistRefs(raw);
    expect(refs.map((r) => [r.name, r.sourceAgentId, r.plainCreator])).toEqual([
      ['Rembrandt van Rijn', '2520', false],
      ['Studio', '61762', false],
    ]);
  });

  it('converts a CC0 print with its web image and life years on the ref', async () => {
    const raw = await fixture('cleveland', 'objects', '136153');
    const { record } = cmaToLinkedArt(raw);
    expect(record._label).toBe('Rembrandt and His Wife Saskia');
    expect(thumbnail('cleveland', record, raw)).toMatch(/^https:\/\/openaccess-cdn\.clevelandart\.org\/.+_web\.jpg$/);
    const [ref] = await createCleveland({ offline: true }).artistRefs(raw);
    expect([ref!.birth, ref!.death, ref!.plainCreator]).toEqual(['1606', '1669', true]);
  });
});

describe('matching people with no ID Wikidata knows', () => {
  it('matches a Wikidata alias with agreeing life years, but leaves it for review', async () => {
    const raw = await fixture('cleveland', 'objects', '136153');
    const [ref] = await createCleveland({ offline: true }).artistRefs(raw);
    const m = matchRef(ref!, rembrandt);
    expect([m.method, m.confidence]).toEqual(['name-dates', 0.8]);
    const d = decide(ref!, [m]);
    expect(d.decision).toBe('review');
    expect(d.reason).toBe('No ID Wikidata knows; name and life years match');
  });

  it('does not match another Rembrandt by name', () => {
    const m = matchRef({ source: 'cleveland', recordId: 'x', name: 'Rembrandt Peale', birth: '1778', death: '1860' }, rembrandt);
    expect(m.method).toBe('none');
  });
});

describe('a decision on a museum agent', () => {
  const decision = { decision: 'merge' as const, qid: 'Q5598', museumName: 'Rembrandt van Rijn', candidateLabel: 'Rembrandt', decidedBy: 'person', decidedAt: '2026-11-20', ai: null };

  it('merges the agent on its "copy after" records too, which stay qualified in the graph', async () => {
    const { applyDecision } = await import('../src/reconcile/agents.js');
    const raw = await fixture('smk', 'objects', 'kmssp404');
    const ref = (await createSmk({ offline: true }).artistRefs(raw))[1]!; // Rembrandt van Rijn, copy after
    const res = applyDecision(decide(ref, [matchRef(ref, rembrandt)]), decision as never);
    expect([res.decision, res.personKey, res.ref.plainCreator]).toEqual(['merged', 'Q5598', false]);
  });

  it('never merges an agent whose own name is qualified', async () => {
    const { applyDecision } = await import('../src/reconcile/agents.js');
    const ref = { source: 'aic', recordId: '1', name: 'School of Rembrandt van Rijn', sourceAgentId: '46371', plainCreator: false };
    const res = applyDecision({ ref, best: null, decision: 'review', personKey: 'aic-46371', reason: 'Qualified role' }, decision as never);
    expect(res.decision).toBe('review');
  });
});
