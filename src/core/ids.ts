// URIs this project mints, under the site's own address (decision 2 in the phase-1 report:
// mint project URIs and keep the museums' URLs as equivalent links).
export const SITE_BASE = 'https://aprigge.github.io/museum-crosswalk/';

export const mint = {
  // IDs are encoded: SMK versos have a space ("KKS18009 verso"). Numeric IDs are unchanged.
  work: (source: string, id: string) => `${SITE_BASE}id/work/${source}-${encodeURIComponent(id)}`,
  visual: (source: string, id: string) => `${SITE_BASE}id/visual/${source}-${encodeURIComponent(id)}`,
  // Encoded: a person a museum names without an ID is keyed by name ("smk-Jan van Vliet").
  person: (key: string) => `${SITE_BASE}id/person/${encodeURIComponent(key)}`,
  /** A print (the composition) by an artist, keyed by catalogue number, e.g. Q5598-B74. */
  print: (artistQid: string, key: string) => `${SITE_BASE}id/print/${artistQid}-${key}`,
  concept: (key: string) => `${SITE_BASE}id/concept/${key}`,
  graph: (name: string) => `${SITE_BASE}graph/${name}`,
  aiSuggestion: (workKey: string, qid: string) => `${SITE_BASE}id/ai/${workKey}-${qid}`,
  aiRun: (promptVersion: string) => `${SITE_BASE}id/ai/run/${promptVersion}`,
};
