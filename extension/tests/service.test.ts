import { describe, expect, it, vi } from 'vitest';
import { READY_TTL_MS, ScoreService, type KeyValueStore } from '@/lib/service';
import type { ScoreResult } from '@/lib/types';

const A1 = 'https://blog.naver.com/blog_a/1';
const A2 = 'https://blog.naver.com/blog_a/2';
const B = 'https://blog.naver.com/blog_b/3';

function memoryStore(): KeyValueStore & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    async get(keys) {
      return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]]));
    },
    async set(items) {
      Object.assign(data, items);
    },
  };
}

function result(url: string, blogId: string, status: ScoreResult['status'], score?: number): ScoreResult {
  return {
    url,
    status,
    blog_id: blogId,
    score: score ?? null,
    level: score === undefined ? null : score >= 70 ? 'high' : 'low',
    reasons: [],
  };
}

function setup(serverResults: (urls: string[]) => ScoreResult[]) {
  let now = 1_000_000;
  const store = memoryStore();
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    const urls = (JSON.parse(String(init?.body)) as { items: { url: string }[] }).items.map((i) => i.url);
    return new Response(JSON.stringify({ results: serverResults(urls) }));
  });
  const service = new ScoreService({
    store,
    fetch: fetch as unknown as typeof globalThis.fetch,
    apiBase: async () => 'http://api',
    now: () => now,
  });
  return { service, store, fetch, advance: (ms: number) => (now += ms) };
}

describe('ScoreService', () => {
  it('sends one url per blog and maps results back to every url', async () => {
    const { service, fetch } = setup((urls) =>
      urls.map((u) => (u.includes('blog_a') ? result(u, 'blog_a', 'ready', 90) : result(u, 'blog_b', 'pending'))),
    );

    const results = await service.scores([A1, A2, B, 'https://example.com']);

    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetch.mock.calls[0]![1]!.body)).items).toEqual([{ url: A1 }, { url: B }]);
    expect(results.map((r) => [r.url, r.status, r.score])).toEqual([
      [A1, 'ready', 90],
      [A2, 'ready', 90],
      [B, 'pending', null],
      ['https://example.com', 'invalid', null],
    ]);
  });

  it('caches ready results but never pending ones', async () => {
    const { service, fetch, advance } = setup((urls) =>
      urls.map((u) => (u.includes('blog_a') ? result(u, 'blog_a', 'ready', 90) : result(u, 'blog_b', 'pending'))),
    );
    await service.scores([A1, B]);
    await service.scores([A2, B]);

    expect(JSON.parse(String(fetch.mock.calls[1]![1]!.body)).items).toEqual([{ url: B }]);

    advance(READY_TTL_MS + 1);
    await service.scores([A1]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('splits large requests into batches of 30', async () => {
    const { service, fetch } = setup((urls) => urls.map((u) => result(u, u.split('/')[3]!, 'pending')));
    const urls = Array.from({ length: 45 }, (_, i) => `https://blog.naver.com/blog${i}/1`);

    await service.scores(urls);

    expect(fetch.mock.calls.map((c) => JSON.parse(String(c[1]!.body)).items.length)).toEqual([30, 15]);
  });

  it('throws when the server fails so the badge can show an error', async () => {
    const { service } = setup(() => []);
    const failing = new ScoreService({
      store: memoryStore(),
      fetch: (async () => new Response('', { status: 500 })) as typeof fetch,
      apiBase: async () => 'http://api',
    });
    await expect(failing.scores([A1])).rejects.toThrow('scores 500');
    await expect(service.scores([])).resolves.toEqual([]);
  });

  it('keeps one anonymous client id per install', async () => {
    const { service } = setup(() => []);
    const first = await service.clientId();
    expect(await service.clientId()).toBe(first);
  });
});

describe('snippetScores', () => {
  it('posts snippets to the snippet endpoint without caching', async () => {
    const store = memoryStore();
    const item = { url: 'https://cafe.naver.com/c/1', title: 't', snippet: 's' };
    const fetch = vi.fn(async () => new Response(JSON.stringify({ results: [{ ...result(item.url, '', 'ready', 10), blog_id: null }] })));
    const service = new ScoreService({ store, fetch: fetch as unknown as typeof globalThis.fetch, apiBase: async () => 'http://api' });

    const [r] = await service.snippetScores([item]);

    expect(r!.status).toBe('ready');
    expect(fetch).toHaveBeenCalledWith('http://api/v1/snippets:score', expect.objectContaining({ body: JSON.stringify({ items: [item] }) }));
    expect(store.data).toEqual({});
  });
});
