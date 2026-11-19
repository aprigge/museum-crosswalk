// URIs this project mints, under the site's own address (decision 2 in the phase-1 report:
// mint project URIs and keep the museums' URLs as equivalent links).
export const SITE_BASE = 'https://aprigge.github.io/museum-crosswalk/';

export const mint = {
  work: (source: string, id: string) => `${SITE_BASE}id/work/${source}-${id}`,
  visual: (source: string, id: string) => `${SITE_BASE}id/visual/${source}-${id}`,
  person: (key: string) => `${SITE_BASE}id/person/${key}`,
  concept: (key: string) => `${SITE_BASE}id/concept/${key}`,
  graph: (name: string) => `${SITE_BASE}graph/${name}`,
};
