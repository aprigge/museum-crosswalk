import type { ArtistMatch, ArtistQuery, SourceArtistRef } from '../core/types.js';

/** Wikidata external-ID properties that belong to a source, found by property label. */
const SOURCE_PROPERTY_LABELS: Record<string, RegExp> = {
  rijksmuseum: /rijksmuseum/i, // only the Research Library authority ID exists, not the museum's agent ID
  met: /\bmet constituent|metropolitan museum/i, // P10882 "Met Constituent ID"
  aic: /\bartic\b|art institute of chicago/i, // P6295 "ARTIC artist ID"
};

/** Roles that mean "not simply by the artist". Matched on the source's own wording. */
const QUALIFIED_ROLE =
  /\b(after|attributed|copy|copied|follower|circle|school|manner|workshop|imitator|style of|former|formerly|possibly|forgery|fake|influenced_by)\b/i;

export function normaliseName(name: string): string {
  const n = name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
  // "Gogh, Vincent van" -> "vincent van gogh"
  const inverted = n.match(/^([^,]+),\s*(.+)$/);
  return (inverted ? `${inverted[2]} ${inverted[1]}` : n).replace(/\s+/g, ' ');
}

const year = (d?: string) => d?.match(/-?\d{4}/)?.[0];

export function isQualifiedRole(role?: string): boolean {
  return !!role && QUALIFIED_ROLE.test(role);
}

/** Every Wikidata external ID of the artist that agrees with an ID the source gives. */
function crosswalk(ref: SourceArtistRef, artist: ArtistQuery): { pid: string; label: string; value: string }[] {
  const candidates: [string, string | undefined][] = [
    ['P245', ref.ulan],
    ['P650', ref.otherIds?.rkd],
  ];
  const sourceLabel = SOURCE_PROPERTY_LABELS[ref.source];
  const localId = ref.sourceAgentId?.split('/').at(-1);
  for (const [pid, prop] of Object.entries(artist.externalIds)) {
    if (sourceLabel?.test(prop.label)) candidates.push([pid, localId]);
  }
  const hits: { pid: string; label: string; value: string }[] = [];
  for (const [pid, value] of candidates) {
    const prop = artist.externalIds[pid];
    if (value && prop?.values.includes(value)) hits.push({ pid, label: prop.label, value });
  }
  return hits;
}

/** Match one source artist reference to the authority. Never merges silently: every result says how. */
export function matchRef(ref: SourceArtistRef, artist: ArtistQuery): ArtistMatch {
  if (ref.wikidata) {
    const same = ref.wikidata === artist.qid;
    return {
      ref,
      qid: ref.wikidata,
      method: 'exact-id',
      confidence: 1,
      evidence: same
        ? `Source links Wikidata ${ref.wikidata} directly`
        : `Source links a different Wikidata entity (${ref.wikidata}), not ${artist.qid}`,
    };
  }
  const xw = crosswalk(ref, artist);
  if (xw.length) {
    // One agreeing ID can be a Wikidata data error (it lists AIC's "Imitator of" agent
    // under P6295 for Van Gogh); two independent ones are much stronger.
    return {
      ref,
      qid: artist.qid,
      method: 'wikidata-crosswalk',
      confidence: xw.length > 1 ? 0.9 : 0.7,
      evidence: `${artist.qid} lists ${xw.map((x) => `${x.pid} (${x.label}) = ${x.value}`).join('; ')}`,
    };
  }
  if (ref.name && normaliseName(ref.name) === normaliseName(artist.name)) {
    const datesKnown = year(ref.birth) && year(ref.death);
    const datesMatch = datesKnown && year(ref.birth) === year(artist.birth) && year(ref.death) === year(artist.death);
    if (datesMatch) {
      return { ref, qid: artist.qid, method: 'name-dates', confidence: 0.8, evidence: 'Name and life years match' };
    }
    return {
      ref,
      qid: artist.qid,
      method: 'name-dates',
      confidence: datesKnown ? 0.2 : 0.5,
      evidence: datesKnown
        ? `Name matches but life years differ (${year(ref.birth)}–${year(ref.death)})`
        : 'Name matches; source gives no life dates',
    };
  }
  return { ref, qid: null, method: 'none', confidence: 0, evidence: 'No ID, crosswalk or name match' };
}

export interface ReviewItem {
  source: string;
  recordId: string;
  reason: string;
  matches: ArtistMatch[];
}

export interface RecordReconciliation {
  source: string;
  recordId: string;
  /** True when some artist ref is an exact-ID match to the authority with a plain creator role. */
  confirmed: boolean;
  matches: ArtistMatch[];
  review: ReviewItem | null;
}

export function reconcileRecord(
  source: string,
  recordId: string,
  refs: SourceArtistRef[],
  artist: ArtistQuery,
): RecordReconciliation {
  const matches = refs.map((r) => matchRef(r, artist));
  const toArtist = matches.filter((m) => m.qid === artist.qid);
  const exact = toArtist.filter((m) => m.method === 'exact-id');
  const reasons: string[] = [];

  if (!refs.length) reasons.push('Record names no artist');
  else if (!toArtist.length) reasons.push(`No artist on the record matches ${artist.qid}`);
  else if (!exact.length) reasons.push(`Artist matched by ${toArtist.map((m) => m.method).join(', ')}, not an exact ID`);
  // Some sources (AIC) put the qualifier in the agent's name, e.g. "Imitator of Vincent van Gogh".
  const qualified = toArtist.filter(
    (m) => m.ref.plainCreator === false || isQualifiedRole(m.ref.role) || isQualifiedRole(m.ref.name),
  );
  if (qualified.length) reasons.push(`Qualified role: ${qualified.map((m) => m.ref.role).join('; ')}`);

  const confirmed = exact.length > 0 && !qualified.length;
  return {
    source,
    recordId,
    confirmed,
    matches,
    review: reasons.length ? { source, recordId, reason: reasons.join('. '), matches } : null,
  };
}
