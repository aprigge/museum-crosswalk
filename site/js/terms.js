// Search term handling shared by the index build (Node) and the search page (browser),
// so a query is processed exactly as the documents were.

/** Fields indexed, and how much a match in each counts. */
export const SEARCH_FIELDS = ['title', 'artists', 'styles', 'inferredStyles', 'subjects', 'museumName'];
export const BOOST = { title: 2, artists: 2, styles: 1.5, inferredStyles: 1.2, subjects: 1, museumName: 0.5 };

/** Fields kept in the index to draw a result without fetching anything else. */
export const STORE_FIELDS = [
  'title', 'museum', 'museumName', 'artists', 'artistKeys', 'qualified', 'begin', 'end',
  'styles', 'inferredStyles', 'subjects', 'thumb', 'url', 'license', 'record',
];

/** Plain words for how a field matched, for the "why this matched" chips. */
export const FIELD_EXPLANATION = {
  title: 'title',
  artists: 'artist',
  styles: "museum's style",
  inferredStyles: "artist's movement (Wikidata)",
  subjects: 'subject',
  museumName: 'museum',
};

const STOP = new Set(['a', 'an', 'and', 'at', 'by', 'de', 'des', 'du', 'en', 'et', 'for', 'from', 'in', 'la', 'le', 'les', 'of', 'on', 'or', 'the', 'to', 'with']);

/**
 * A light stemmer: enough to meet "Impressionist" with "Impressionism" and "landscapes"
 * with "landscape", without a dictionary. Ordered longest suffix first.
 */
export function stem(word) {
  if (word.length <= 3) return word;
  for (const [suffix, replacement] of [
    ['ists', ''], ['isms', ''], ['ist', ''], ['ism', ''],
    ['ies', 'y'], ['es', ''], ['s', ''],
  ]) {
    if (suffix === 's' && /(ss|us|is)$/.test(word)) continue; // glass, Degas-like names, iris
    // Plurals may leave a 3-letter base (boxes -> box); -ist/-ism need 4 (artist must not become "art").
    const minBase = /^i/.test(suffix) ? 4 : 3;
    if (word.endsWith(suffix) && word.length - suffix.length >= minBase) {
      const base = word.slice(0, word.length - suffix.length) + replacement;
      // "landscapes" -> "landscap" + "" would lose the e: keep words ending in a vowel+s simple.
      if (suffix === 'es' && !/(ch|sh|s|x|z)$/.test(base)) return word.slice(0, -1);
      return base;
    }
  }
  return word;
}

/**
 * Split text into words, keeping hyphenated words whole: "Post-Impressionism" is its own
 * movement, and splitting it would let "Impressionist" match it.
 */
export function tokenize(text) {
  return text.split(/[^\p{L}\p{N}'’-]+|(?<![\p{L}\p{N}])-|-(?![\p{L}\p{N}])/u).filter(Boolean);
}

/**
 * Search settings for the page and the evaluation alike. Every term must match. Fuzzy matching
 * allows one edit on words of 6+ letters only: a fraction of the length let "impression"
 * match "expression".
 */
export const SEARCH_OPTIONS = {
  boost: BOOST,
  combineWith: 'AND',
  prefix: (term) => term.length >= 4,
  fuzzy: (term) => (term.length >= 6 ? 1 : false),
};

/** MiniSearch processTerm: lowercase, drop accents and stop words, then stem. */
export function processTerm(term) {
  const t = term.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]s$/, '');
  if (!t || STOP.has(t)) return null;
  return stem(t);
}

export const MUSEUM_NAMES = { rijksmuseum: 'Rijksmuseum', met: 'The Met', aic: 'Art Institute of Chicago' };
