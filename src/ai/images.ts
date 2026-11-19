import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cacheKey, dataDir } from '../core/cache.js';
import { userAgent } from '../core/http.js';

/** One gap per host, as the JSON client keeps: images come from the same museum servers. */
const GAP_MS: Record<string, number> = { 'www.artic.edu': 1000, 'images.metmuseum.org': 3000, 'iiif.micr.io': 500 };
const lastByHost = new Map<string, number>();

export interface CachedImage {
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  data: Buffer;
}

const path = (url: string) => join(dataDir(), 'raw', 'images', `${cacheKey(url)}.bin`);

/**
 * An image as bytes, fetched once with the project's User-Agent and cached. Sending images to
 * Claude as base64 keeps the run independent of whether a museum lets Anthropic's servers
 * fetch them (AIC turned away some clients in phase 2).
 */
export async function getImage(url: string): Promise<CachedImage> {
  const file = path(url);
  try {
    const meta = JSON.parse(await readFile(`${file}.json`, 'utf8')) as { mediaType: CachedImage['mediaType'] };
    return { mediaType: meta.mediaType, data: await readFile(file) };
  } catch {
    // not cached yet
  }
  const host = new URL(url).host;
  const wait = (lastByHost.get(host) ?? 0) + (GAP_MS[host] ?? 1000) - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastByHost.set(host, Date.now());
  const ua = userAgent();
  const res = await fetch(url, { headers: { 'User-Agent': ua, 'AIC-User-Agent': ua } });
  if (!res.ok) throw new Error(`Image HTTP ${res.status} for ${url}`);
  const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim();
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(type)) throw new Error(`Unexpected image type "${type}" for ${url}`);
  const data = Buffer.from(await res.arrayBuffer());
  await mkdir(join(dataDir(), 'raw', 'images'), { recursive: true });
  await writeFile(file, data);
  await writeFile(`${file}.json`, JSON.stringify({ url, mediaType: type, fetchedAt: new Date().toISOString() }));
  return { mediaType: type as CachedImage['mediaType'], data };
}
