import type { CachedRaw } from '../core/types.js';

// Prints: one composition (a plate) printed many times, each impression held as its own object.
// Museums cite the catalogues that number Rembrandt's etchings: Bartsch (1797), whose numbering
// Hollstein / White & Boon (1969) keep, and the New Hollstein (2013), with its own. Impressions
// are grouped only by those numbers, never by title.

type Node = Record<string, any>;

export type ObjectType = 'print' | 'drawing' | 'painting' | 'other';

const AAT_TYPE: Record<string, ObjectType> = {
  '300041273': 'print',
  '300033973': 'drawing',
  '300033618': 'painting',
};

/** The object type as each museum states it, reduced to print / drawing / painting / other. */
export function objectType(source: string, raw: CachedRaw): ObjectType {
  const b = raw.body as Node;
  const word = (s: unknown): ObjectType | null => {
    const t = String(s ?? '').toLowerCase();
    if (/\bprints?\b/.test(t)) return 'print';
    if (/\bdrawing/.test(t)) return 'drawing';
    if (/\bpainting/.test(t)) return 'painting';
    return null;
  };
  switch (source) {
    case 'rijksmuseum':
      for (const c of b.classified_as ?? []) {
        for (const e of c.equivalent ?? []) {
          const t = AAT_TYPE[String(e.id).split('/').at(-1)!];
          if (t) return t;
        }
      }
      return 'other';
    case 'met':
      return word(b.classification) ?? word(b.objectName) ?? 'other';
    case 'aic':
      return word(b.data?.artwork_type_title) ?? 'other';
    case 'smk':
      return (b.object_names ?? []).map((n: Node) => word(n.name)).find(Boolean) ?? 'other';
    case 'cleveland':
      return word(b.type) ?? 'other';
    default:
      return 'other';
  }
}

export interface CatalogueRefs {
  /** Bartsch number, also Hollstein's / White & Boon's for Rembrandt (the first cited). */
  bartsch?: number;
  /** New Hollstein number (the first cited). */
  newHollstein?: number;
  /** Every distinct Bartsch number cited: more than one means a sheet with several prints, or an error. */
  bartschAll?: number[];
  /** The state as the museum writes it ("i/iii", "V/X", "3"), not part of the grouping key. */
  state?: string;
  /** The citations the numbers were read from, as the museum wrote them. */
  cited: string[];
}

// "Bartsch 105", "Hollstein Dutch 105", "Hollstein 19 (XVIII.8)", "White & Boon 272 V/VI".
// Not "New Hollstein", not Benesch's "B. 1060" (drawings), not "Illustrated Bartsch 50" (a volume).
const BARTSCH = /(?<!New\s)(?<!Illustrated\s)\b(?:Bartsch|Hollstein(?:\s+Dutch)?|White\s*(?:&|and|-)\s*Boon)\s+(\d{1,3})\b(?:[\s-]+([ivxlc]+\/[ivxlc]+|[IVXLC]+\/[IVXLC]+|[ivx]+\b))?/i;
// "New Hollstein 264 V/X", "New Hollstein Dutch and Flemish (Rembrandt text) 212-3(3)", "NH(Rembrandt).II.7.158".
const NEW_HOLLSTEIN = /\b(?:New\s+Hollstein(?:\s+Dutch(?:\s+and\s+Flemish)?)?(?:\s*\([^)]*\))?|NH\s*\([^)]*\)(?:\.[IVX]+)?(?:\.\d+)?\.)\s*(\d{1,4})\b(?:-(\d+)(?:\(\d+\))?|\s+([IVXLC]+\/[IVXLC]+))?/i;

/** Read Bartsch / New Hollstein numbers from citation strings (in the museum's own order). */
export function parseCitations(cited: string[]): CatalogueRefs {
  const out: CatalogueRefs = { cited: [] };
  for (const c of cited) {
    const text = c.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    for (const part of text.split(/;|\s{2,}/)) {
      const nh = part.match(NEW_HOLLSTEIN);
      if (nh) {
        out.newHollstein ??= Number(nh[1]);
        out.state ??= nh[2] ?? nh[3];
        out.cited.push(part.trim());
        continue;
      }
      const b = part.match(BARTSCH);
      if (b) {
        out.bartsch ??= Number(b[1]);
        if (!(out.bartschAll ??= []).includes(Number(b[1]))) out.bartschAll.push(Number(b[1]));
        out.state ??= b[2];
        out.cited.push(part.trim());
      }
    }
  }
  return out;
}

/** The citation strings each museum gives, then parsed. SMK splits title and number. */
export function catalogueRefs(source: string, raw: CachedRaw): CatalogueRefs {
  const b = raw.body as Node;
  switch (source) {
    case 'rijksmuseum': {
      const cited: string[] = [];
      for (const a of b.assigned_by ?? []) for (const x of a.assigned ?? []) for (const i of x.identified_by ?? []) if (i.content) cited.push(String(i.content));
      return parseCitations(cited);
    }
    case 'aic':
      return parseCitations(String(b.data?.catalogue_display ?? '').split(/<\/p>/));
    case 'cleveland': {
      const refs = parseCitations(String(b.catalogue_raisonne ?? '').split(';'));
      return { ...refs, state: b.state_of_the_work ?? refs.state };
    }
    case 'smk': {
      const cited: string[] = [];
      for (const d of b.documentation ?? []) {
        const title = String(d.title ?? '');
        const num = String(d.notes ?? '').match(/\d+/)?.[0];
        if (!num) continue;
        if (/New Hollstein/i.test(title)) cited.push(`New Hollstein ${num}`);
        else if (/Hollstein's Dutch|Illustrated Bartsch|^Bartsch|Le peintre graveur/i.test(title) && /Rembrandt/i.test(title)) cited.push(`Bartsch ${num}`);
      }
      return parseCitations(cited);
    }
    default:
      return { cited: [] }; // The Met's API gives no catalogue numbers.
  }
}

export interface PrintGroup {
  /** "B105", or "NH212" when no member gives a Bartsch number. */
  key: string;
  bartsch?: number;
  newHollstein?: number;
  members: string[]; // "source:id"
  /** Members whose New Hollstein number usually belongs to another print: kept here, noted. */
  conflict?: string;
}

export interface Grouping {
  groups: PrintGroup[];
  /** Records citing two or more different Bartsch numbers: a sheet with several prints, or an error. */
  severalPrints: string[];
}

const most = (m: Map<number, number>) => [...m].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];

/**
 * Group impressions by Bartsch number. New Hollstein only fills gaps: a record with no Bartsch
 * number joins the print its New Hollstein number belongs to in most records that give both.
 * A record's odd New Hollstein number never joins two prints; it is noted on the group.
 */
export function groupImpressions(items: { key: string; refs: CatalogueRefs }[]): Grouping {
  const severalPrints = items.filter((it) => (it.refs.bartschAll?.length ?? 0) > 1).map((it) => it.key);
  const usable = items.filter((it) => (it.refs.bartschAll?.length ?? 0) <= 1);

  // Which Bartsch number each New Hollstein number goes with, by majority of records giving both.
  const pairs = new Map<number, Map<number, number>>();
  for (const it of usable) {
    const { bartsch: b, newHollstein: nh } = it.refs;
    if (b && nh) {
      const m = pairs.get(nh) ?? pairs.set(nh, new Map()).get(nh)!;
      m.set(b, (m.get(b) ?? 0) + 1);
    }
  }
  const nhToB = new Map([...pairs].map(([nh, m]) => [nh, most(m)!]));

  const groups = new Map<string, { bartsch?: number; nh: Map<number, number>; members: string[]; odd: string[] }>();
  for (const it of usable) {
    const { bartsch: b, newHollstein: nh } = it.refs;
    const key = b ? `B${b}` : nh ? (nhToB.has(nh) ? `B${nhToB.get(nh)}` : `NH${nh}`) : null;
    if (!key) continue;
    const g = groups.get(key) ?? groups.set(key, { bartsch: b ?? (nh ? nhToB.get(nh) : undefined), nh: new Map(), members: [], odd: [] }).get(key)!;
    g.members.push(it.key);
    if (nh) {
      g.nh.set(nh, (g.nh.get(nh) ?? 0) + 1);
      if (b && nhToB.get(nh) !== b) g.odd.push(`${it.key} cites New Hollstein ${nh}, usually Bartsch ${nhToB.get(nh)}`);
    }
  }
  return {
    groups: [...groups].map(([key, g]) => ({
      key,
      bartsch: g.bartsch,
      newHollstein: most(g.nh),
      members: g.members,
      ...(g.odd.length ? { conflict: g.odd.join('; ') } : {}),
    })),
    severalPrints,
  };
}
