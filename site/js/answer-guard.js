// Checks a model-written answer sentence against the result rows it summarises. Shared by the
// Worker (before sending it) and the site (before showing it): plain JS so both can load it.

/** Numbers as written in text: 1,101 -> 1101; years and counts alike. */
const numbersIn = (text) => (String(text).match(/\d[\d,]*(\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ''));

/**
 * Every number in the sentence must appear in the rows or be the row count: an answer may
 * restate the graph's numbers, never invent one. Returns the offending numbers (empty = ok).
 */
export function unsupportedNumbers(sentence, rows, rowCount) {
  const allowed = new Set([String(rowCount), ...rows.flatMap((r) => r.flatMap((c) => numbersIn(c)))]);
  // Strict on purpose: "all 3 museums" passes only if 3 is the row count or in a cell. Numbers
  // written as words ("three") are not checked, so the prompt asks for numbers from the rows.
  return numbersIn(sentence).filter((n) => !allowed.has(n) && !allowed.has(String(Number(n))));
}

/** Rows as sent to the model: readable values only, capped in count and length. */
export function tableForSummary(columns, rows, maxRows = 30) {
  const short = (v) => String(v).replace(/^https:\/\/aprigge\.github\.io\/museum-crosswalk\/id\//, '').slice(0, 160);
  return { columns, rows: rows.slice(0, maxRows).map((r) => r.map(short)), rowCount: rows.length };
}
