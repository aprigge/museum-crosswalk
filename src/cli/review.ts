import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDir } from '../core/cache.js';
import type { ReviewCase, ReviewProposal } from '../ai/review.js';
import { main } from './common.js';

// Record a person's decisions on Claude's review proposals:
//   npm run review -- --accept-all
//   npm run review -- --accept aic-63743,aic-42673 --reject aic-29571
// A rejected merge is kept separate; a rejected keep-separate is merged. needs-human stays pending.

export const DECISIONS_FILE = 'alignments/review-decisions.json';

export interface ReviewDecision {
  decision: 'merge' | 'keep-separate';
  qid: string;
  museumName?: string;
  candidateLabel: string;
  decidedBy: 'person';
  decidedAt: string;
  /** What the AI proposed, and why: kept with the decision as its trail. */
  ai: { model: string; prompt: string; decision: string; confidence: number; reasons: ReviewProposal['reasons'] } | null;
}

const list = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? (process.argv[i + 1] ?? '').split(',').filter(Boolean) : [];
};

main(async () => {
  const file = JSON.parse(await readFile(join(dataDir(), 'reconcile', 'paintings-1850-1900', 'ai-review.json'), 'utf8')) as {
    prompt: string;
    model: string;
    cases: (ReviewCase & { proposal: ReviewProposal | null })[];
  };
  const decisions = JSON.parse(await readFile(DECISIONS_FILE, 'utf8').catch(() => '{}')) as Record<string, ReviewDecision>;
  const acceptAll = process.argv.includes('--accept-all');
  const accept = new Set(list('--accept'));
  const reject = new Set(list('--reject'));
  if (!acceptAll && !accept.size && !reject.size) throw new Error('Usage: npm run review -- --accept-all | --accept k1,k2 --reject k3');

  let recorded = 0;
  for (const c of file.cases) {
    const p = c.proposal;
    if (!p || p.decision === 'needs-human') continue;
    const accepted = reject.has(c.key) ? false : acceptAll || accept.has(c.key) ? true : null;
    if (accepted === null) continue;
    const decision = accepted ? p.decision : p.decision === 'merge' ? 'keep-separate' : 'merge';
    decisions[c.key] = {
      decision,
      qid: c.candidate.qid,
      museumName: c.museum.name,
      candidateLabel: c.candidate.label,
      decidedBy: 'person',
      decidedAt: new Date().toISOString(),
      ai: { model: file.model, prompt: file.prompt, decision: p.decision, confidence: p.confidence, reasons: p.reasons },
    };
    recorded++;
  }
  const sorted = Object.fromEntries(Object.entries(decisions).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(DECISIONS_FILE, JSON.stringify(sorted, null, 2) + '\n');
  const all = Object.values(sorted);
  console.log(`${recorded} decisions recorded; ${DECISIONS_FILE} now holds ${all.filter((d) => d.decision === 'merge').length} merges and ${all.filter((d) => d.decision === 'keep-separate').length} kept separate.`);
});
