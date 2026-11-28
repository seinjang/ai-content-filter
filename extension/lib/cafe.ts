/**
 * 사용자가 연 카페 글 페이지에서 본문을 읽는다.
 *
 * PC 카페는 바깥 페이지(cafe.naver.com/{카페}/{글번호})가 글을 같은 출처의 iframe
 * (cafe.naver.com/ca-fe/cafes/{카페 숫자 ID}/articles/{글번호})에 띄운다. 본문은 블로그와 같은
 * 스마트에디터 ONE 구조라 서버 app/parsers.py의 _parse_smart_editor와 같은 규칙으로 읽는다.
 */
import type { ArticleItem } from './types';

const ARTICLE_PATH = /^\/ca-fe\/cafes\/\d+\/articles\/(\d+)/;
const CAFE_NAME = /^[A-Za-z0-9_-]{1,50}$/;
const BODY_COMPONENTS = ['se-text', 'se-quotation', 'se-table'];
// 서버 /v1/articles:score 요청 제한
const LIMITS = { paragraphs: 1000, paragraph: 5000, headings: 200, heading: 300, links: 500, link: 2048, title: 300 };

const clean = (s: string | null | undefined) => (s ?? '').replace(/[​‌‍﻿]/g, '').replace(/\s+/g, ' ').trim();

/**
 * 검색 결과와 같은 형식의 글 주소(cafe.naver.com/{카페}/{글번호})를 만든다.
 * 글번호는 iframe 주소에서, 카페 이름은 바깥 페이지 주소의 첫 경로에서 가져온다.
 */
export function cafeArticleUrl(topHref: string, frameHref: string): string | null {
  // 글번호는 항상 iframe에서 읽는다. iframe 안에서 다른 글로 넘어가도 바깥 주소는 그대로일 수 있다.
  let top: URL, frame: URL;
  try {
    top = new URL(topHref);
    frame = new URL(frameHref);
  } catch {
    return null;
  }
  const articleId = frame.pathname.match(ARTICLE_PATH)?.[1];
  const cafe = top.pathname.split('/').filter(Boolean)[0];
  // shortcut: 바깥 페이지 없이 /ca-fe/ 주소를 직접 연 경우는 카페 이름을 몰라 건너뛴다. 필요해지면 카페 숫자 ID로 키를 바꾼다.
  if (!articleId || !cafe || cafe === 'ca-fe' || !CAFE_NAME.test(cafe)) return null;
  return `https://cafe.naver.com/${cafe}/${articleId}`;
}

export function extractArticle(doc: Document, url: string): ArticleItem | null {
  const container = doc.querySelector('.se-main-container');
  // 본문은 스크립트가 나중에 그리므로, 컴포넌트가 생기기 전이면 아직 읽지 않는다.
  if (!container?.querySelector('.se-component')) return null;
  const headings: string[] = [];
  const paragraphs: string[] = [];
  for (const comp of container.querySelectorAll('.se-component')) {
    const texts = [...comp.querySelectorAll('p.se-text-paragraph')].map((p) => clean(p.textContent)).filter(Boolean);
    if (comp.classList.contains('se-sectionTitle')) headings.push(...texts);
    else if (BODY_COMPONENTS.some((c) => comp.classList.contains(c))) paragraphs.push(...texts);
  }
  const links = [...container.querySelectorAll<HTMLAnchorElement>('a[href]')].map((a) => a.href);
  const title = clean((doc.querySelector('.ArticleTitle .title_text') ?? doc.querySelector('.title_text'))?.textContent);
  return {
    url,
    title: title.slice(0, LIMITS.title),
    paragraphs: paragraphs.slice(0, LIMITS.paragraphs).map((p) => p.slice(0, LIMITS.paragraph)),
    headings: headings.slice(0, LIMITS.headings).map((h) => h.slice(0, LIMITS.heading)),
    links: links.filter((l) => l.length <= LIMITS.link).slice(0, LIMITS.links),
  };
}
