import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BADGE_TAG } from '@/lib/badge';
import { findTargets, Scanner } from '@/lib/scanner';
import type { ScoreResult } from '@/lib/types';

// 실제 검색 결과처럼 같은 글을 가리키는 링크가 여러 개(썸네일, 제목, 요약)인 구조
const RESULTS = `
  <ul>
    <li class="item">
      <a href="https://blog.naver.com/info_bot/100"><img alt=""></a>
      <a href="https://blog.naver.com/info_bot/100">2025 무선청소기 추천 순위 TOP 7 총정리</a>
      <a href="https://blog.naver.com/info_bot/100">무선청소기 추천…</a>
    </li>
    <li class="item">
      <a href="https://m.blog.naver.com/walker/200">망원동 작은 로스터리에서 핸드드립 마신 날</a>
    </li>
    <li class="item"><a href="https://news.naver.com/x">뉴스 결과는 무시</a></li>
  </ul>`;

function ready(url: string, blogId: string, score: number, level: ScoreResult['level']): ScoreResult {
  return { url, status: 'ready', blog_id: blogId, score, level, reasons: ['근거'] };
}

const chipText = (host: Element) => host.shadowRoot!.querySelector('.label')!.textContent;

describe('findTargets', () => {
  it('picks the longest-text link per post as its title', () => {
    document.body.innerHTML = RESULTS;
    const targets = findTargets(document);
    expect(targets.map((t) => t.anchor.textContent)).toEqual([
      '2025 무선청소기 추천 순위 TOP 7 총정리',
      '망원동 작은 로스터리에서 핸드드립 마신 날',
    ]);
  });
});

describe('Scanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = RESULTS;
  });
  afterEach(() => vi.useRealTimers());

  it('shows loading, then polls pending results until ready', async () => {
    const scores = vi
      .fn()
      .mockResolvedValueOnce([
        ready('https://blog.naver.com/info_bot/100', 'info_bot', 94, 'high'),
        { url: 'https://m.blog.naver.com/walker/200', status: 'pending', blog_id: 'walker', score: null, level: null, reasons: [] },
      ])
      .mockResolvedValueOnce([ready('https://m.blog.naver.com/walker/200', 'walker', 0, 'low')]);
    const scanner = new Scanner(document, { scores, feedback: vi.fn(), snippetScores: vi.fn(), pollIntervalMs: 1000 });

    await scanner.scan();
    const badges = [...document.querySelectorAll(BADGE_TAG)];
    expect(badges).toHaveLength(2);
    expect(badges.map(chipText)).toEqual(['양산형 의심 높음', '분석 중']);

    await vi.advanceTimersByTimeAsync(1000);
    expect(scores).toHaveBeenLastCalledWith(['https://m.blog.naver.com/walker/200']);
    expect(chipText(badges[1]!)).toBe('양산형 의심 낮음');
  });

  it('gives up after maxPolls', async () => {
    const pending = (urls: string[]) =>
      urls.map((url) => ({ url, status: 'pending', blog_id: 'x', score: null, level: null, reasons: [] }));
    const scores = vi.fn(async (urls: string[]) => pending(urls) as ScoreResult[]);
    const scanner = new Scanner(document, { scores, feedback: vi.fn(), snippetScores: vi.fn(), pollIntervalMs: 10, maxPolls: 3 });

    await scanner.scan();
    await vi.advanceTimersByTimeAsync(100);

    expect(scores).toHaveBeenCalledTimes(3);
    expect([...document.querySelectorAll(BADGE_TAG)].map(chipText)).toEqual(['분석 실패', '분석 실패']);
  });

  it('does not add duplicate badges on rescan and picks up new results', async () => {
    const scores = vi.fn(async (urls: string[]) => urls.map((u) => ready(u, 'b', 10, 'low')));
    const scanner = new Scanner(document, { scores, feedback: vi.fn(), snippetScores: vi.fn() });

    await scanner.scan();
    await scanner.scan();
    expect(document.querySelectorAll(BADGE_TAG)).toHaveLength(2);

    document.querySelector('ul')!.insertAdjacentHTML(
      'beforeend',
      '<li><a href="https://blog.naver.com/new_one/300">무한 스크롤로 추가된 결과</a></li>',
    );
    await scanner.scan();
    expect(document.querySelectorAll(BADGE_TAG)).toHaveLength(3);
    expect(scores).toHaveBeenLastCalledWith(['https://blog.naver.com/new_one/300']);
  });

  it('places the badge before the longest link (under the title, above the summary)', async () => {
    document.body.innerHTML = `<div>
      <a href="https://blog.naver.com/info_bot/100">무선청소기 추천 TOP 7</a>
      <a href="https://blog.naver.com/info_bot/100">무선청소기를 고를 때 흡입력과 무게를 먼저 보세요…</a></div>`;
    const scores = vi.fn(async (urls: string[]) => urls.map((u) => ready(u, 'b', 10, 'low')));
    await new Scanner(document, { scores, feedback: vi.fn(), snippetScores: vi.fn() }).scan();

    const links = document.querySelectorAll('a');
    expect(links[1]!.previousElementSibling?.tagName.toLowerCase()).toBe(BADGE_TAG);
    expect(links[0]!.nextElementSibling?.tagName.toLowerCase()).toBe(BADGE_TAG);
  });

  it('re-adds a badge the page removed while re-rendering', async () => {
    const scores = vi.fn(async (urls: string[]) => urls.map((u) => ready(u, 'b', 10, 'low')));
    const scanner = new Scanner(document, { scores, feedback: vi.fn(), snippetScores: vi.fn() });
    await scanner.scan();

    document.querySelector(BADGE_TAG)!.remove();
    await scanner.scan();

    expect(document.querySelectorAll(BADGE_TAG)).toHaveLength(2);
    expect(scores).toHaveBeenLastCalledWith(['https://blog.naver.com/info_bot/100']);
  });

  it('shows an error badge when the server is unreachable', async () => {
    const scanner = new Scanner(document, { scores: vi.fn().mockRejectedValue(new Error('down')), feedback: vi.fn(), snippetScores: vi.fn() });
    await scanner.scan();
    expect([...document.querySelectorAll(BADGE_TAG)].map(chipText)).toEqual(['분석 실패', '분석 실패']);
  });

  it('opens reasons on click without following the result link, and sends feedback', async () => {
    const feedback = vi.fn().mockResolvedValue(undefined);
    const scores = vi.fn(async (urls: string[]) => urls.map((u) => ready(u, 'b', 94, 'high')));
    const scanner = new Scanner(document, { scores, feedback, snippetScores: vi.fn() });
    await scanner.scan();

    const host = document.querySelector(BADGE_TAG)!;
    const root = host.shadowRoot!;
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true });
    root.querySelector<HTMLButtonElement>('.chip')!.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(root.querySelector<HTMLElement>('.panel')!.hidden).toBe(false);
    expect(root.querySelector('.panel li')!.textContent).toBe('근거');

    root.querySelector<HTMLButtonElement>('button[data-label="ok"]')!.click();
    await vi.waitFor(() => expect(root.querySelector('.thanks')).not.toBeNull());
    expect(feedback).toHaveBeenCalledWith('https://blog.naver.com/info_bot/100', 'ok');
  });

  it('escapes reasons from the server', async () => {
    const scores = vi.fn(async (urls: string[]) =>
      urls.map((u) => ({ ...ready(u, 'b', 94, 'high'), reasons: ['<img src=x onerror=alert(1)>'] })),
    );
    await new Scanner(document, { scores, feedback: vi.fn(), snippetScores: vi.fn() }).scan();
    const panel = document.querySelector(BADGE_TAG)!.shadowRoot!.querySelector('.panel')!;
    expect(panel.querySelector('img')).toBeNull();
    expect(panel.querySelector('li')!.textContent).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('cafe articles', () => {
  const CAFE = 'https://cafe.naver.com/somecafe/123?art=abc';
  const CAFE_RESULT = `<div>
    <a href="https://cafe.naver.com/somecafe">우리동네 맘카페새 창 열림</a>
    <a href="${CAFE}">무선청소기 추천 순위 TOP 7새 창 열림</a>
    <a href="${CAFE}">업체로부터 제품을 제공받아 작성한 후기입니다 #청소기 #추천새 창 열림</a></div>`;

  it('finds cafe articles with title and snippet, ignoring the cafe home link', () => {
    document.body.innerHTML = CAFE_RESULT;
    const [t, ...rest] = findTargets(document);
    expect(rest).toHaveLength(0);
    expect(t).toMatchObject({ kind: 'cafe', key: 'cafe:somecafe/123', title: '무선청소기 추천 순위 TOP 7' });
    expect(t!.anchor.textContent).toContain('업체로부터');
  });

  it('scores snippets without polling and marks the badge as snippet-based', async () => {
    document.body.innerHTML = CAFE_RESULT;
    const scores = vi.fn();
    const snippetScores = vi.fn(async (items: { url: string }[]) =>
      items.map((i) => ({ ...ready(i.url, '', 82, 'high'), blog_id: null, source: 'cafe' as const, basis: 'snippet' as const })),
    );
    await new Scanner(document, { scores, feedback: vi.fn(), snippetScores }).scan();

    expect(scores).not.toHaveBeenCalled();
    expect(snippetScores).toHaveBeenCalledWith([
      { url: CAFE, title: '무선청소기 추천 순위 TOP 7', snippet: '업체로부터 제품을 제공받아 작성한 후기입니다 #청소기 #추천' },
    ]);
    const root = document.querySelector(BADGE_TAG)!.shadowRoot!;
    expect(root.querySelector('.label')!.textContent).toBe('양산형 의심 높음 · 요약');
    expect(root.querySelector('.chip')!.classList.contains('snippet')).toBe(true);
    expect(root.querySelector('.basis')!.textContent).toBe('카페 글 · 검색 요약문만 분석');
    expect(root.querySelector('button.fb')).toBeNull();
  });

  it('labels blog results as full analysis', async () => {
    document.body.innerHTML = RESULTS;
    const scores = vi.fn(async (urls: string[]) => urls.map((u) => ready(u, 'b', 10, 'low')));
    await new Scanner(document, { scores, feedback: vi.fn(), snippetScores: vi.fn() }).scan();
    const root = document.querySelector(BADGE_TAG)!.shadowRoot!;
    expect(root.querySelector('.label')!.textContent).toBe('양산형 의심 낮음');
    expect(root.querySelector('.basis')!.textContent).toBe('블로그 · 최근 글 분석');
  });
});

describe('cafe reply previews', () => {
  it('ignores comment preview links when placing the badge', () => {
    const CAFE = 'https://cafe.naver.com/somecafe/123?art=abc';
    document.body.innerHTML = `<div>
      <a href="${CAFE}">용인 유명맛집 미가훠궈</a>
      <a href="${CAFE}">식당이 으리으리하네요 평일인데 만석</a>
      <a href="${CAFE}"><div><p><i>RE</i>저도 용인으로 이사오고 처음 외식한 맛집 입니다 요즘도 자주가요 갈때마다</p></div></a>
      <a href="${CAFE}">REVIEW 용인 맛집 지도 총정리 목록입니다 다녀온 곳 모두 정리했어요 아주 길게</a></div>`;
    const [t] = findTargets(document);
    // "RE" 요소가 따로 있는 댓글은 빼고, 'REVIEW'로 시작하는 일반 링크는 남긴다
    expect(t!.anchor.textContent).toContain('REVIEW');
    document.querySelectorAll('a')[3]!.remove();
    expect(findTargets(document)[0]!.anchor.textContent).toBe('식당이 으리으리하네요 평일인데 만석');
  });
});
