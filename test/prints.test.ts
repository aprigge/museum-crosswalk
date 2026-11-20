import { describe, expect, it } from 'vitest';
import { catalogueRefs, groupImpressions, objectType, parseCitations } from '../src/graph/prints.js';
import { fixture } from './helpers.js';

describe('catalogue numbers', () => {
  it('reads Bartsch and New Hollstein as the Rijksmuseum cites them', () => {
    const r = parseCitations(['Bartsch 105', 'Hollstein Dutch 105', 'New Hollstein Dutch and Flemish (Rembrandt text) 212-3(3)']);
    expect([r.bartsch, r.newHollstein, r.state]).toEqual([105, 212, '3']);
  });

  it('reads AIC\'s HTML list with states, and ignores other catalogues', () => {
    const r = parseCitations('<p>Bartsch 272 V/IV</p><p>Hind 251</p><p>White & Boon 272 V/VI</p><p>New Hollstein 264 V/X</p>'.split(/<\/p>/));
    expect([r.bartsch, r.newHollstein]).toEqual([272, 264]);
  });

  it('reads Cleveland\'s catalogue_raisonne field', () => {
    const r = parseCitations('Hollstein 19 (XVIII.8); White-Boon 19-i; NH(Rembrandt).II.7.158'.split(';'));
    expect([r.bartsch, r.newHollstein]).toEqual([19, 158]);
  });

  it('does not read Benesch, a Bartsch volume, or New Hollstein as Bartsch', () => {
    expect(parseCitations(['B. 1060']).bartsch).toBeUndefined();
    expect(parseCitations(['The Illustrated Bartsch 50, Supplement']).bartsch).toBeUndefined();
    expect(parseCitations(['New Hollstein 33']).bartsch).toBeUndefined();
  });

  it('reads SMK documentation titles and notes', async () => {
    const r = catalogueRefs('smk', await fixture('smk', 'objects', 'KKS5960'));
    expect([r.bartsch, r.newHollstein]).toEqual([82, 204]);
  });

  it('reads Cleveland\'s state of the work', async () => {
    const r = catalogueRefs('cleveland', await fixture('cleveland', 'objects', '136153'));
    expect([r.bartsch, r.newHollstein, r.state]).toEqual([19, 158, 'i/iii']);
  });
});

describe('object types', () => {
  it('reduces each museum\'s type to print / drawing / painting', async () => {
    expect(objectType('smk', await fixture('smk', 'objects', 'KKS5960'))).toBe('print');
    expect(objectType('smk', await fixture('smk', 'objects', 'kmssp404'))).toBe('painting');
    expect(objectType('cleveland', await fixture('cleveland', 'objects', '124089'))).toBe('painting');
  });
});

describe('grouping impressions', () => {
  const r = (bartsch?: number, newHollstein?: number, bartschAll?: number[]) => ({ bartsch, newHollstein, bartschAll: bartschAll ?? (bartsch ? [bartsch] : []), cited: [] });

  it('groups by Bartsch, and joins a record with only New Hollstein through the usual pairing', () => {
    const { groups } = groupImpressions([
      { key: 'rijksmuseum:1', refs: r(74, 239) },
      { key: 'aic:3', refs: r(74, 239) },
      { key: 'smk:2', refs: r(undefined, 239) },
      { key: 'met:4', refs: r() },
      { key: 'cleveland:5', refs: r(19) },
    ]);
    expect(groups.map((g) => [g.key, g.members.sort()])).toEqual([
      ['B74', ['aic:3', 'rijksmuseum:1', 'smk:2']],
      ['B19', ['cleveland:5']],
    ]);
  });

  it('never lets one odd record join two prints, and notes it', () => {
    // As found: AIC cites Bartsch 68 with New Hollstein 139, which belongs to Bartsch 69.
    const { groups } = groupImpressions([
      { key: 'a:1', refs: r(68, 138) },
      { key: 'a:2', refs: r(69, 139) },
      { key: 'a:3', refs: r(69, 139) },
      { key: 'aic:200626', refs: r(68, 139) },
    ]);
    expect(groups.map((g) => [g.key, g.members.length])).toEqual([['B68', 2], ['B69', 2]]);
    expect(groups[0]!.conflict).toBe('aic:200626 cites New Hollstein 139, usually Bartsch 69');
  });

  it('leaves a record citing several prints ungrouped', () => {
    const { groups, severalPrints } = groupImpressions([{ key: 'rijksmuseum:200124932', refs: r(69, 139, [69, 72]) }]);
    expect([groups.length, severalPrints]).toEqual([0, ['rijksmuseum:200124932']]);
  });
});
