import type { SourceAdapter } from '../core/types.js';
import { createAic } from './aic.js';
import { createMet } from './met.js';
import { createRijksmuseum } from './rijksmuseum.js';

/** Adding a source: write one adapter and register it here. */
export const SOURCES: Record<string, (opts: { refresh?: boolean }) => SourceAdapter> = {
  rijksmuseum: createRijksmuseum,
  met: createMet,
  aic: createAic,
};

export function selectSources(arg: string | undefined, opts: { refresh?: boolean } = {}): SourceAdapter[] {
  const names = !arg || arg === 'all' ? Object.keys(SOURCES) : arg.split(',');
  return names.map((n) => {
    const make = SOURCES[n];
    if (!make) throw new Error(`Unknown source "${n}". Known: ${Object.keys(SOURCES).join(', ')}`);
    return make(opts);
  });
}
