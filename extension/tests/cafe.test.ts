import { describe, expect, it } from 'vitest';
import { cafeArticleUrl, extractArticle } from '@/lib/cafe';

const FRAME = 'https://cafe.naver.com/ca-fe/cafes/10070820/articles/4358587?art=x&where=search';

describe('cafeArticleUrl', () => {
  it.each([
    'https://cafe.naver.com/zzop/4358587?art=x&tc=naver_search',
    'https://cafe.naver.com/zzop',
    'https://cafe.naver.com/zzop/1111', // 바깥 주소가 이전 글이어도 iframe의 글번호를 쓴다
  ])('builds the search-result style url from %s', (top) => {
    expect(cafeArticleUrl(top, FRAME)).toBe('https://cafe.naver.com/zzop/4358587');
  });

  it.each([
    ['https://cafe.naver.com/ca-fe/cafes/10070820/articles/4358587', FRAME], // 카페 이름을 모름
    ['https://cafe.naver.com/zzop', 'https://cafe.naver.com/ca-fe/cafes/10070820/articles'], // 글 목록
    ['https://cafe.naver.com/zzop', 'about:blank'],
  ])('returns null for %s in %s', (top, frame) => {
    expect(cafeArticleUrl(top, frame)).toBeNull();
  });
});

describe('extractArticle', () => {
  it('reads smart editor components like the server parser', () => {
    document.body.innerHTML = `
      <div class="ArticleTitle"><h3 class="title_text"> 무선청소기 추천 </h3></div>
      <div class="se-main-container">
        <div class="se-component se-sectionTitle"><p class="se-text-paragraph">목차</p></div>
        <div class="se-component se-text">
          <p class="se-text-paragraph">첫 문단​</p><p class="se-text-paragraph">​</p>
          <p class="se-text-paragraph"><a href="https://link.coupang.com/a/x">쿠팡</a> 링크</p>
        </div>
        <div class="se-component se-image"><p class="se-text-paragraph">사진 설명</p></div>
      </div>`;
    expect(extractArticle(document, 'https://cafe.naver.com/zzop/1')).toEqual({
      url: 'https://cafe.naver.com/zzop/1',
      title: '무선청소기 추천',
      headings: ['목차'],
      paragraphs: ['첫 문단', '쿠팡 링크'],
      links: ['https://link.coupang.com/a/x'],
    });
  });

  it('waits until the body is rendered', () => {
    document.body.innerHTML = '<div class="se-main-container"></div>';
    expect(extractArticle(document, 'https://cafe.naver.com/zzop/1')).toBeNull();
  });

  it('caps paragraph length to the server limit', () => {
    document.body.innerHTML = `<div class="se-main-container"><div class="se-component se-text">
      <p class="se-text-paragraph">${'가'.repeat(6000)}</p></div></div>`;
    expect(extractArticle(document, 'u')!.paragraphs[0]).toHaveLength(5000);
  });
});

describe('cafe badge', () => {
  it('shows full-body cafe results as solid chips without feedback buttons', async () => {
    const { createBadge, stateFromResult } = await import('@/lib/badge');
    const badge = createBadge(document, async () => {});
    badge.update(
      stateFromResult({ url: 'u', status: 'ready', blog_id: null, score: 82, level: 'high', reasons: [], source: 'cafe', basis: 'full' }),
    );
    const root = badge.element.shadowRoot!;
    expect(root.querySelector('.label')!.textContent).toBe('양산형 의심 높음');
    expect(root.querySelector('.chip')!.classList.contains('snippet')).toBe(false);
    expect(root.querySelector('.basis')!.textContent).toBe('카페 글 · 본문 전체 분석');
    expect(root.querySelector('button.fb')).toBeNull();
  });
});
