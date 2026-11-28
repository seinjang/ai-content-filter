/**
 * background에서 도는 점수 조회 서비스.
 * 블로그 단위 로컬 캐시 → 미스만 모아 서버에 배치 요청.
 * chrome API에 직접 의존하지 않도록 저장소와 fetch를 주입받는다 (테스트용).
 */
import { parseBlogPostUrl, parseCafeArticleUrl } from './naver';
import type { ArticleItem, FeedbackLabel, ScoreResult, SnippetItem } from './types';

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

// 블로그는 blogId, 카페 글은 'cafe:{카페}/{글번호}' (blogId에는 ':'가 없어 겹치지 않는다)
const cacheKey = (id: string) => `score:${id}`;

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

  /**
   * 카페 글 (검색 결과): 사용자가 글을 열어 본문으로 판정한 결과가 있으면 그것을 쓰고,
   * 나머지는 요약문으로 판정한다. 요약문 판정은 서버가 요청마다 계산하므로 캐시하지 않는다.
   */
  async snippetScores(items: SnippetItem[]): Promise<ScoreResult[]> {
    const keys = items.map((i) => parseCafeArticleUrl(i.url)?.key);
    const stored = await this.deps.store.get(keys.flatMap((k) => (k ? [cacheKey(k)] : [])));
    const full = new Map<string, ScoreResult>();
    items.forEach((item, i) => {
      const hit = keys[i] && (stored[cacheKey(keys[i])] as Cached | undefined);
      if (hit && hit.expiresAt > this.now()) {
        const { expiresAt: _, ...rest } = hit;
        full.set(item.url, { ...rest, url: item.url });
      }
    });

    const misses = items.filter((i) => !full.has(i.url));
    const fresh = new Map<string, ScoreResult>();
    for (let i = 0; i < misses.length; i += MAX_BATCH) {
      const res = await this.deps.fetch(`${await this.deps.apiBase()}/v1/snippets:score`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: misses.slice(i, i + MAX_BATCH) }),
      });
      if (!res.ok) throw new Error(`snippets ${res.status}`);
      for (const r of ((await res.json()) as { results: ScoreResult[] }).results) fresh.set(r.url, r);
    }
    return items.map((i) => full.get(i.url) ?? fresh.get(i.url) ?? invalid(i.url));
  }

  /** 사용자가 연 카페 글을 본문으로 판정하고, 검색 결과에서 다시 쓰도록 이 브라우저에만 저장한다. */
  async articleScore(item: ArticleItem): Promise<ScoreResult> {
    const res = await this.deps.fetch(`${await this.deps.apiBase()}/v1/articles:score`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(item),
    });
    if (!res.ok) throw new Error(`article ${res.status}`);
    const result = (await res.json()) as ScoreResult;
    const key = parseCafeArticleUrl(item.url)?.key;
    if (key && result.status === 'ready') {
      const { url: _, ...rest } = result;
      await this.deps.store.set({ [cacheKey(key)]: { ...rest, expiresAt: this.now() + READY_TTL_MS } });
    }
    return result;
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
