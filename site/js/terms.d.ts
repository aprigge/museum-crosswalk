// Types for terms.js, which stays plain JavaScript so the browser can load it as is.
export const SEARCH_FIELDS: string[];
export const BOOST: Record<string, number>;
export const STORE_FIELDS: string[];
export const FIELD_EXPLANATION: Record<string, string>;
export const MUSEUM_NAMES: { rijksmuseum: string; met: string; aic: string };
export function stem(word: string): string;
export function processTerm(term: string): string | null;
export function tokenize(text: string): string[];
export const SEARCH_OPTIONS: {
  boost: Record<string, number>;
  combineWith: 'AND';
  prefix: (term: string) => boolean;
  fuzzy: (term: string) => number | false;
};
