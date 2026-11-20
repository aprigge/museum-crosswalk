// SPARQL helpers shared by the site, the Ask Worker and the eval (plain JS so the browser loads it as is).

/** Prefixes every query may use; the schema card lists the same ones. */
export const ASK_PREFIXES = `PREFIX mc: <https://aprigge.github.io/museum-crosswalk/ns#>
PREFIX dcterms: <http://purl.org/dc/terms/>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
PREFIX schema: <https://schema.org/>
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX id: <https://aprigge.github.io/museum-crosswalk/id/>
`;

/** Add the standard prefixes unless the query declares its own. */
export const withPrefixes = (q) => (/^\s*PREFIX\s/im.test(q) ? q : ASK_PREFIXES + q);

/**
 * Only read queries run: SELECT, ASK or CONSTRUCT, never an update. A second line of defence:
 * the browser runs queries with Oxigraph's query(), which cannot execute updates at all.
 * Comments start at a line start or after whitespace; a '#' inside an IRI (ns#Work) is not one.
 */
export function isReadQuery(q) {
  const body = q.replace(/(^|\s)#[^\n]*/g, '$1').replace(/PREFIX\s+\S*\s*<[^>]*>/gi, '').replace(/BASE\s*<[^>]*>/gi, '').trim();
  return /^(SELECT|ASK|CONSTRUCT|DESCRIBE)\b/i.test(body) && !/\b(INSERT|DELETE|LOAD|CLEAR|DROP|CREATE|ADD|MOVE|COPY)\b\s*(DATA|WHERE|\{|<|GRAPH|SILENT|ALL|DEFAULT)/i.test(body);
}

