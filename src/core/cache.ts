import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { CachedRaw } from './types.js';

/** Read at call time so tests can point it at fixtures or a temp dir. */
export const dataDir = () => process.env.DATA_DIR ?? 'data';

/** File-safe key for an ID that may be a URL. */
export function cacheKey(id: string): string {
  return id.replace(/^https?:\/\//, '').replace(/[^A-Za-z0-9._-]+/g, '_');
}

export function rawPath(source: string, kind: string, id: string): string {
  return join(dataDir(), 'raw', source, kind, `${cacheKey(id)}.json`);
}

export async function readCached(source: string, kind: string, id: string): Promise<CachedRaw | null> {
  try {
    return JSON.parse(await readFile(rawPath(source, kind, id), 'utf8')) as CachedRaw;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeCached(kind: string, raw: CachedRaw): Promise<void> {
  await writeJson(rawPath(raw.source, kind, raw.id), raw);
}

/** All cached raw records of one kind for a source. */
export async function listCached(source: string, kind: string): Promise<CachedRaw[]> {
  const dir = join(dataDir(), 'raw', source, kind);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const out: CachedRaw[] = [];
  for (const n of names.filter((n) => n.endsWith('.json')).sort()) {
    out.push(JSON.parse(await readFile(join(dir, n), 'utf8')) as CachedRaw);
  }
  return out;
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n');
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}
