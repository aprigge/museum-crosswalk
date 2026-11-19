// AAT terms Linked Art recommends (linked.art/model/vocab/recommended and /required).
// These are identifiers only; nothing here fetches from vocab.getty.edu.
const aat = (n: number) => `http://vocab.getty.edu/aat/${n}`;

export const AAT = {
  primaryName: aat(300404670),
  accessionNumber: aat(300312355),
  description: aat(300435416),
  productionStatement: aat(300435436),
  signatureStatement: aat(300028705),
  inscriptionStatement: aat(300435414),
  materialsStatement: aat(300435429),
  dimensionsStatement: aat(300435430),
  creditLine: aat(300026687),
  provenanceStatement: aat(300435438),
  rightsStatement: aat(300435434),
  summary: aat(300026032),
  briefText: aat(300418049),
  webPage: aat(300264578),
  digitalImage: aat(300215302),
  height: aat(300055644),
  width: aat(300055647),
  depth: aat(300072633),
  centimetres: aat(300379098),
  english: aat(300388277),
} as const;

/** Rijksmuseum and Linked Art sometimes use the https form of the same AAT URI. */
export function sameTerm(a: string | undefined, b: string): boolean {
  return !!a && a.replace(/^https:/, 'http:') === b.replace(/^https:/, 'http:');
}
