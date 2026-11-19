import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import jsonld from 'jsonld';

const schemaDir = new URL('../../schemas/', import.meta.url);
const load = (name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(name, schemaDir)), 'utf8'));

const LA_CONTEXT_URL = 'https://linked.art/ns/v1/linked-art.json';
const laContext = load('linked-art-context.json');

let objectValidator: ReturnType<Ajv2020['compile']> | null = null;

/**
 * The published schemas declare draft 2020-12 but use the older tuple form
 * `items: [...]`, which 2020-12 rejects. Rewrite it to `prefixItems`.
 */
export function upgradeTupleItems(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(upgradeTupleItems);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'items' && Array.isArray(v)) out.prefixItems = upgradeTupleItems(v);
    else out[k] = upgradeTupleItems(v);
  }
  return out;
}

function validator() {
  if (!objectValidator) {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    (addFormats as unknown as (a: Ajv2020) => void)(ajv);
    ajv.addSchema(upgradeTupleItems(load('core.json')) as object);
    objectValidator = ajv.compile(upgradeTupleItems(load('object.json')) as object);
  }
  return objectValidator;
}

/** Our provenance keys. Linked Art's own `_label` is not one of them and must stay. */
const PROVENANCE_KEYS = new Set(['_provenance', '_fieldProvenance']);

/** Strip our provenance keys before validating. */
function stripPrivate(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => !PROVENANCE_KEYS.has(k)));
}

export function validateSchema(record: Record<string, unknown>): string[] {
  const v = validator();
  if (v(stripPrivate(record))) return [];
  return (v.errors ?? []).map((e) => {
    const p = e.params as { additionalProperty?: string; missingProperty?: string };
    const detail = p.additionalProperty
      ? ` "${p.additionalProperty}"`
      : p.missingProperty
        ? ` "${p.missingProperty}"`
        : '';
    return `${e.instancePath || '/'} ${e.message}${detail}`;
  });
}

/**
 * Group schema errors by what went wrong, ignoring the array index and the side
 * errors that anyOf branches produce (`const`, "must match a schema in anyOf").
 */
export function schemaErrorKind(error: string): string | null {
  if (/must be equal to constant|must match a schema in anyOf|must match exactly one schema/.test(error)) return null;
  const extra = error.match(/additional properties "(.+)"$/);
  if (extra) return `extra property \`${extra[1]}\``;
  const missing = error.match(/required property '(.+)'/);
  if (missing) return `missing \`${missing[1]}\``;
  return error.replace(/\/\d+/g, '/*');
}

/** Offline document loader: serves the vendored Linked Art context, refuses everything else. */
const documentLoader = async (url: string) => {
  if (url === LA_CONTEXT_URL) return { contextUrl: undefined, documentUrl: url, document: laContext };
  throw new Error(`Refusing to load remote JSON-LD document ${url}`);
};

/** The record as N-Quads (default graph), offline, without our provenance keys. */
export async function toNQuads(record: Record<string, unknown>): Promise<string> {
  return (await jsonld.toRDF(stripPrivate(record) as jsonld.JsonLdDocument, {
    format: 'application/n-quads',
    documentLoader: documentLoader as never,
  } as jsonld.Options.ToRdf)) as unknown as string;
}

/** Expand with jsonld.js; returns problems, including terms that dropped out on expansion. */
export async function validateJsonLd(record: Record<string, unknown>): Promise<string[]> {
  try {
    const expanded = await jsonld.expand(stripPrivate(record) as jsonld.JsonLdDocument, {
      documentLoader: documentLoader as never,
      safe: true,
    } as jsonld.Options.Expand);
    return expanded.length ? [] : ['expanded to an empty graph'];
  } catch (err) {
    return [`jsonld: ${(err as Error).message}`];
  }
}
