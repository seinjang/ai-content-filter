/**
 * background에서 도는 점수 조회 서비스.
 * 블로그 단위 로컬 캐시 → 미스만 모아 서버에 배치 요청.
 * chrome API에 직접 의존하지 않도록 저장소와 fetch를 주입받는다 (테스트용).
 */
import { parseBlogPostUrl } from './naver';
import type { FeedbackLabel, ScoreResult } from './types';

export const READY_TTL_MS = 6 * 60 * 60 * 1000;
export const UNAVAILABLE_TTL_MS = 60 * 60 * 1000;
export const MAX_BATCH = 30;
export const DEFAULT_API_BASE = 'http://127.0.0.1:8000';

type Cached = Omit<ScoreResult, 'url'> & { expiresAt: number };

export interface KeyValueStore {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface ServiceDeps {
  store: KeyValueStore;
  fetch: typeof fetch;
  apiBase: () => Promise<string>;
  now?: () => number;
}

const cacheKey = (blogId: string) => `score:${blogId}`;

export class ScoreService {
  private now: () => number;

  constructor(private deps: ServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  async scores(urls: string[]): Promise<ScoreResult[]> {
    const refs = urls.map((u) => parseBlogPostUrl(u));
    const blogIds = [...new Set(refs.flatMap((r) => (r ? [r.blogId] : [])))];
    const stored = await this.deps.store.get(blogIds.map(cacheKey));

    const cached = new Map<string, Cached>();
    for (const id of blogIds) {
      const hit = stored[cacheKey(id)] as Cached | undefined;
      if (hit && hit.expiresAt > this.now()) cached.set(id, hit);
    }

    // 캐시에 없는 블로그마다 대표 URL 하나만 서버에 보낸다.
    const misses = new Map<string, string>();
    urls.forEach((url, i) => {
      const ref = refs[i];
      if (ref && !cached.has(ref.blogId) && !misses.has(ref.blogId)) misses.set(ref.blogId, url);
    });

    const fresh = new Map<string, ScoreResult>();
    const missUrls = [...misses.values()];
    for (let i = 0; i < missUrls.length; i += MAX_BATCH) {
      for (const r of await this.request(missUrls.slice(i, i + MAX_BATCH))) {
        if (r.blog_id) fresh.set(r.blog_id, r);
      }
    }
    await this.remember([...fresh.values()]);

    return urls.map((url, i) => {
      const ref = refs[i];
      if (!ref) return invalid(url);
      const hit = cached.get(ref.blogId) ?? fresh.get(ref.blogId);
      if (!hit) return { ...invalid(url), status: 'pending', blog_id: ref.blogId };
      const { expiresAt: _, ...rest } = hit as Cached;
      return { ...rest, url };
    });
  }

  async feedback(url: string, label: FeedbackLabel): Promise<void> {
    const res = await this.deps.fetch(`${await this.deps.apiBase()}/v1/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, label, client_id: await this.clientId() }),
    });
    if (!res.ok) throw new Error(`feedback ${res.status}`);
  }

  /** 설치마다 한 번 만드는 익명 ID. 서버에는 해시만 저장된다. */
  async clientId(): Promise<string> {
    const { clientId } = await this.deps.store.get(['clientId']);
    if (typeof clientId === 'string') return clientId;
    const id = crypto.randomUUID();
    await this.deps.store.set({ clientId: id });
    return id;
  }

  private async request(urls: string[]): Promise<ScoreResult[]> {
    const res = await this.deps.fetch(`${await this.deps.apiBase()}/v1/scores:batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: urls.map((url) => ({ url })) }),
    });
    if (!res.ok) throw new Error(`scores ${res.status}`);
    return ((await res.json()) as { results: ScoreResult[] }).results;
  }

  private async remember(results: ScoreResult[]): Promise<void> {
    const items: Record<string, Cached> = {};
    for (const { url: _, ...r } of results) {
      if (!r.blog_id) continue;
      if (r.status === 'ready') items[cacheKey(r.blog_id)] = { ...r, expiresAt: this.now() + READY_TTL_MS };
      if (r.status === 'unavailable')
        items[cacheKey(r.blog_id)] = { ...r, expiresAt: this.now() + UNAVAILABLE_TTL_MS };
    }
    if (Object.keys(items).length) await this.deps.store.set(items);
  }
}

function invalid(url: string): ScoreResult {
  return { url, status: 'invalid', blog_id: null, score: null, level: null, reasons: [] };
}
