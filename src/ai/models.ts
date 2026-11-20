// Model names and the structured-output format: no Node APIs, so the Worker can import them too.

export const MODELS = {
  /** Enrichment, review assist and Ask. */
  main: 'claude-opus-5-5',
  /** The eval's relevance judge: a different model from the one whose work it grades. */
  judge: 'claude-sonnet-5-5',
} as const;

/** The structured-output format for a hand-written JSON schema (the same shape works in batches). */
export const jsonFormat = (schema: Record<string, unknown>) => ({ type: 'json_schema' as const, schema });
