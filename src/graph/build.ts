import oxigraph from 'oxigraph';
import { mint } from '../core/ids.js';
import type { CachedRaw, Provenance } from '../core/types.js';
import type { Concept } from '../authority/concepts.js';
import type { AgentResolution, PersonFacts } from '../reconcile/agents.js';
import { thumbnail, webPageUrl, workConcepts, workTitle, workYears, type ConceptRef } from './extract.js';
import type { CatalogueRefs, ObjectType, PrintGroup } from './prints.js';

const { namedNode, literal, quad } = oxigraph;
type Node = Record<string, any>;
type Term = ReturnType<typeof namedNode>;

/** Vocabularies: standard ones where they fit, and `mc:` for this project's crosswalk terms. */
export const NS = {
  mc: `${mint.graph('').replace(/graph\/$/, '')}ns#`,
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  owl: 'http://www.w3.org/2002/07/owl#',
  skos: 'http://www.w3.org/2004/02/skos/core#',
  dcterms: 'http://purl.org/dc/terms/',
  prov: 'http://www.w3.org/ns/prov#',
  schema: 'https://schema.org/',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  wd: 'http://www.wikidata.org/entity/',
};
const n = (ns: keyof typeof NS, local: string) => namedNode(NS[ns] + local);
const int = (v: number) => literal(String(v), namedNode(`${NS.xsd}integer`));
const dec = (v: number) => literal(String(v), namedNode(`${NS.xsd}decimal`));
const dateTime = (v: string) => literal(v, namedNode(`${NS.xsd}dateTime`));

export const GRAPHS = {
  crosswalk: namedNode(mint.graph('crosswalk')),
  derived: namedNode(mint.graph('derived')),
  alignments: namedNode(mint.graph('alignments')),
  /** Suggestions made by a model from the images: labelled as such everywhere they appear. */
  ai: namedNode(mint.graph('ai')),
  source: (s: string) => namedNode(mint.graph(s)),
};

/** Suggestions below this confidence are kept as annotations but don't reach search. */
export const AI_MIN_CONFIDENCE = 0.6;

export interface AiRun {
  model: string;
  promptVersion: string;
  at: string;
}

export interface WorkInput {
  source: string;
  id: string;
  /** The datasets this object was harvested for, e.g. paintings-1850-1900, rembrandt. */
  datasets?: string[];
  objectType?: ObjectType;
  /** Catalogue numbers and state the museum cites (prints). */
  catalogue?: CatalogueRefs;
  record: Node;
  related: Node[];
  raw: CachedRaw;
}

/**
 * Concept key for the graph: its Wikidata QID when resolved, else a readable source-based key.
 * A Wikidata link the source gives itself wins over our own AAT/Iconclass lookup: the Met tags
 * "Landscapes" with AAT 300132294 (which Wikidata maps to "natural landscape") and also says,
 * more directly, Q191163 "landscape painting".
 */
export function conceptKey(ref: ConceptRef, concepts: Map<string, Concept>): { key: string; resolved?: Concept } {
  const all = [ref.uri, ...ref.equivalents];
  const ordered = [...all.filter((u) => u.includes('wikidata.org/entity/')), ...all.filter((u) => !u.includes('wikidata.org/entity/'))];
  for (const uri of ordered) {
    const c = concepts.get(uri);
    if (c) return { key: c.qid, resolved: c };
  }
  const u = ref.uri;
  const aat = u.match(/aat\/(\d+)$/);
  const tm = u.match(/category-terms\/(TM-\d+)$/);
  const key = aat ? `aat-${aat[1]}` : tm ? `aic-${tm[1]}` : `src-${u.replace(/^https?:\/\//, '').replace(/[^A-Za-z0-9]+/g, '-')}`;
  return { key };
}

/**
 * Build the crosswalk layer: works linked to merged people and to Wikidata-backed concepts,
 * with provenance; styles inferred from an artist's movement go in the `derived` graph.
 * The museums' own Linked Art goes in per-source graphs via `addLinkedArt`.
 */
export class GraphBuilder {
  readonly store = new oxigraph.Store();
  private conceptsSeen = new Set<string>();
  /** Kept apart from conceptsSeen: an AI suggestion must not stop the museums' labels being added. */
  private aiConceptsSeen = new Set<string>();
  private runsSeen = new Set<string>();
  private peopleSeen = new Set<string>();

  constructor(
    private readonly concepts: Map<string, Concept>,
    private readonly people: Map<string, PersonFacts>,
  ) {}

  private add(s: Term, p: Term, o: Parameters<typeof quad>[2], g = GRAPHS.crosswalk) {
    this.store.add(quad(s, p, o, g));
  }

  /** Load a source's Linked Art (as N-Quads from jsonld.toRDF) into its own named graph. */
  addLinkedArt(source: string, nquads: string) {
    this.store.load(nquads, { format: 'application/n-quads', to_graph_name: GRAPHS.source(source), lenient: true });
  }

  /** The project's hand-written alignments (Turtle). */
  addAlignments(turtle: string) {
    this.store.load(turtle, { format: 'text/turtle', to_graph_name: GRAPHS.alignments });
  }

  private concept(ref: ConceptRef): Term | null {
    const { key, resolved } = conceptKey(ref, this.concepts);
    const label = resolved?.label ?? ref.label;
    if (!label) return null; // e.g. a Rijksmuseum Type with no label and no Wikidata match: nothing to search on
    const node = namedNode(mint.concept(key));
    if (!this.conceptsSeen.has(key)) {
      this.conceptsSeen.add(key);
      this.add(node, n('rdf', 'type'), n('skos', 'Concept'));
      this.add(node, n('skos', 'prefLabel'), literal(label, 'en'));
      for (const a of resolved?.aliases ?? []) this.add(node, n('skos', 'altLabel'), literal(a, 'en'));
      if (resolved) this.add(node, n('owl', 'sameAs'), n('wd', resolved.qid));
    }
    // Every museum's own word for the concept is searchable ("child", "Children"), not just the
    // first one seen; the store keeps one copy of each.
    if (ref.label && ref.label !== label) this.add(node, n('skos', 'altLabel'), literal(ref.label, 'en'));
    // Record how each source URI reaches the concept: exactly, or through a broader Iconclass code.
    for (const uri of [ref.uri, ...ref.equivalents]) {
      const c = this.concepts.get(uri);
      const rel = c?.match === 'broad' ? 'broadMatch' : 'exactMatch';
      this.add(node, n('skos', rel), namedNode(uri));
    }
    return node;
  }

  private movementConcept(m: { qid: string; label: string }): Term {
    const node = namedNode(mint.concept(m.qid));
    if (!this.conceptsSeen.has(m.qid)) {
      this.conceptsSeen.add(m.qid);
      this.add(node, n('rdf', 'type'), n('skos', 'Concept'));
      this.add(node, n('skos', 'prefLabel'), literal(m.label, 'en'));
      this.add(node, n('owl', 'sameAs'), n('wd', m.qid));
    }
    return node;
  }

  private person(r: AgentResolution): Term {
    const node = namedNode(mint.person(r.personKey));
    const facts = r.decision === 'merged' ? this.people.get(r.personKey) : undefined;
    if (!this.peopleSeen.has(r.personKey)) {
      this.peopleSeen.add(r.personKey);
      this.add(node, n('rdf', 'type'), n('schema', 'Person'));
      this.add(node, n('rdfs', 'label'), literal(facts?.name && !/^Q\d+$/.test(facts.name) ? facts.name : (r.ref.name ?? r.personKey)));
      if (facts) {
        this.add(node, n('owl', 'sameAs'), n('wd', facts.qid));
        const by = Number(facts.birth?.slice(0, 4));
        const dy = Number(facts.death?.slice(0, 4));
        if (by) this.add(node, n('mc', 'birthYear'), int(by));
        if (dy) this.add(node, n('mc', 'deathYear'), int(dy));
        for (const m of facts.movements) this.add(node, n('mc', 'movement'), this.movementConcept(m));
        // As Wikidata states them: a label to query by, and the Wikidata item to follow.
        for (const b of facts.birthPlaces ?? []) {
          this.add(node, n('mc', 'birthPlace'), literal(b.label));
          this.add(node, n('schema', 'birthPlace'), n('wd', b.qid));
        }
        for (const c of facts.citizenships ?? []) {
          this.add(node, n('mc', 'citizenship'), literal(c.label));
          this.add(node, n('schema', 'nationality'), n('wd', c.qid));
        }
        for (const g of facts.genders ?? []) this.add(node, n('mc', 'gender'), literal(g.label));
      }
    }
    // The museum's own record of this person, and how it was matched.
    const agentKey = `${r.ref.source}-${(r.ref.sourceAgentId ?? r.ref.name ?? 'unknown').split('/').at(-1)}`;
    const agent = namedNode(`${mint.person('')}agent/${encodeURIComponent(agentKey)}`);
    this.add(node, n('mc', 'sourceAgent'), agent);
    this.add(agent, n('mc', 'museum'), literal(r.ref.source));
    if (r.ref.name) this.add(agent, n('rdfs', 'label'), literal(r.ref.name));
    if (r.ref.sourceAgentId?.startsWith('http')) this.add(agent, n('skos', 'exactMatch'), namedNode(r.ref.sourceAgentId));
    this.add(agent, n('mc', 'matchDecision'), literal(r.decision));
    if (r.best) {
      this.add(agent, n('mc', 'matchMethod'), literal(r.best.method));
      this.add(agent, n('mc', 'matchConfidence'), dec(r.best.confidence));
      this.add(agent, n('mc', 'matchEvidence'), literal(r.best.evidence));
      // Who the evidence points to, even when policy keeps the record unmerged (e.g. "after" records).
      if (r.best.qid) this.add(agent, n('mc', 'matchCandidate'), n('wd', r.best.qid));
    }
    if (r.reason) this.add(agent, n('mc', 'reviewReason'), literal(r.reason));
    return node;
  }

  /** One work's crosswalk triples. `artists` are this record's resolved refs. */
  addWork(w: WorkInput, artists: AgentResolution[]) {
    const work = namedNode(mint.work(w.source, w.id));
    const prov = w.record._provenance as Provenance;
    this.add(work, n('rdf', 'type'), n('mc', 'Work'));
    this.add(work, n('mc', 'museum'), literal(w.source));
    for (const d of w.datasets ?? []) this.add(work, n('mc', 'dataset'), literal(d));
    if (w.objectType) this.add(work, n('mc', 'objectType'), literal(w.objectType));
    for (const c of w.catalogue?.cited ?? []) this.add(work, n('mc', 'catalogueRef'), literal(c));
    if (w.catalogue?.state) this.add(work, n('mc', 'state'), literal(w.catalogue.state));
    this.add(work, n('skos', 'exactMatch'), namedNode(String(w.record.id)));
    const title = workTitle(w.record);
    if (title) this.add(work, n('dcterms', 'title'), literal(title));
    const { begin, end } = workYears(w.record);
    if (begin !== undefined) this.add(work, n('mc', 'beginYear'), int(begin));
    if (end !== undefined) this.add(work, n('mc', 'endYear'), int(end));
    const page = webPageUrl(w.record);
    if (page) this.add(work, n('schema', 'url'), namedNode(page));
    const thumb = thumbnail(w.source, w.record, w.raw);
    if (thumb) this.add(work, n('schema', 'thumbnailUrl'), namedNode(thumb));
    // Provenance of the museum record this work comes from.
    this.add(work, n('dcterms', 'source'), namedNode(prov.sourceUrl));
    this.add(work, n('prov', 'generatedAtTime'), dateTime(prov.fetchedAt));
    if (/^https?:/.test(prov.license)) this.add(work, n('dcterms', 'license'), namedNode(prov.license));
    else this.add(work, n('mc', 'licenseNote'), literal(prov.licenseNote ?? prov.license));

    for (const r of artists) {
      const p = this.person(r);
      // A plain, accepted attribution is "by"; anything qualified stays separate and says so.
      const plain = r.decision !== 'review' || !/Qualified role/.test(r.reason ?? '');
      if (plain && r.ref.plainCreator !== false) this.add(work, n('mc', 'artist'), p);
      else this.add(work, n('mc', 'qualifiedArtist'), p);
    }

    const { styles, subjects } = workConcepts(w.record, w.related);
    for (const s of styles) {
      const c = this.concept(s);
      if (c) this.add(work, n('mc', 'style'), c);
    }
    for (const s of subjects) {
      const c = this.concept(s);
      if (c) this.add(work, n('mc', 'subject'), c);
    }
    // Inferred style: the movement Wikidata gives for a merged artist. Kept in its own graph,
    // never as the museum's claim.
    for (const r of artists) {
      if (r.decision !== 'merged' || r.ref.plainCreator === false) continue;
      for (const m of this.people.get(r.personKey)?.movements ?? []) {
        this.add(work, n('mc', 'inferredStyle'), this.movementConcept(m), GRAPHS.derived);
      }
    }
  }

  /**
   * AI-suggested subjects for one work, in graph/ai. Every suggestion becomes an annotation
   * (confidence, the visual evidence, the run that made it); only those at or above `minConfidence`
   * also link the work to the concept directly, which is what search uses.
   */
  addAiSubjects(
    source: string,
    id: string,
    suggestions: { qid: string; label: string; confidence: number; evidence: string }[],
    run: AiRun,
    minConfidence = AI_MIN_CONFIDENCE,
  ) {
    const g = GRAPHS.ai;
    const work = namedNode(mint.work(source, id));
    const runNode = namedNode(mint.aiRun(run.promptVersion));
    if (!this.runsSeen.has(run.promptVersion)) {
      this.runsSeen.add(run.promptVersion);
      this.add(runNode, n('rdf', 'type'), n('prov', 'Activity'), g);
      this.add(runNode, n('mc', 'model'), literal(run.model), g);
      this.add(runNode, n('mc', 'promptVersion'), literal(run.promptVersion), g);
      this.add(runNode, n('prov', 'endedAtTime'), dateTime(run.at), g);
    }
    for (const sgn of suggestions) {
      const concept = namedNode(mint.concept(sgn.qid));
      if (!this.aiConceptsSeen.has(sgn.qid)) {
        // A concept only the AI uses (from the reviewed vocabulary extension) is defined here.
        this.aiConceptsSeen.add(sgn.qid);
        this.add(concept, n('rdf', 'type'), n('skos', 'Concept'), g);
        this.add(concept, n('skos', 'prefLabel'), literal(sgn.label, 'en'), g);
        this.add(concept, n('owl', 'sameAs'), n('wd', sgn.qid), g);
      }
      const note = namedNode(mint.aiSuggestion(`${source}-${id}`, sgn.qid));
      this.add(note, n('rdf', 'type'), n('mc', 'AiSuggestion'), g);
      this.add(note, n('mc', 'onWork'), work, g);
      this.add(note, n('mc', 'concept'), concept, g);
      this.add(note, n('mc', 'confidence'), dec(sgn.confidence), g);
      this.add(note, n('mc', 'evidence'), literal(sgn.evidence), g);
      this.add(note, n('prov', 'wasGeneratedBy'), runNode, g);
      if (sgn.confidence >= minConfidence) this.add(work, n('mc', 'aiSubject'), concept, g);
    }
  }

  /**
   * Prints by one artist, each grouping the impressions museums hold, by catalogue number
   * (src/graph/prints.ts). Our own grouping, so it lives in the crosswalk graph.
   */
  addPrints(artistQid: string, groups: PrintGroup[], titles: Map<string, string>) {
    for (const g of groups) {
      const print = namedNode(mint.print(artistQid, g.key));
      this.add(print, n('rdf', 'type'), n('mc', 'Print'));
      this.add(print, n('mc', 'artist'), namedNode(mint.person(artistQid)));
      if (g.bartsch) this.add(print, n('mc', 'bartsch'), int(g.bartsch));
      if (g.newHollstein) this.add(print, n('mc', 'newHollstein'), int(g.newHollstein));
      if (g.conflict) this.add(print, n('mc', 'groupingConflict'), literal(g.conflict));
      // The title most impressions carry (titles come English-first, so ties go to English).
      const counts = new Map<string, number>();
      for (const t of g.members.map((m) => titles.get(m)).filter(Boolean) as string[]) counts.set(t, (counts.get(t) ?? 0) + 1);
      const title = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (title) this.add(print, n('dcterms', 'title'), literal(title));
      for (const m of g.members) {
        const [source, id] = [m.slice(0, m.indexOf(':')), m.slice(m.indexOf(':') + 1)];
        this.add(namedNode(mint.work(source, id)), n('mc', 'impressionOf'), print);
      }
    }
  }

  counts(): Record<string, number> {
    const rows = this.store.query('SELECT ?g (COUNT(*) AS ?n) WHERE { GRAPH ?g { ?s ?p ?o } } GROUP BY ?g') as Map<string, any>[];
    return Object.fromEntries(rows.map((r) => [r.get('g').value, Number(r.get('n').value)]));
  }
}
