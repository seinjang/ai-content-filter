/**
 * content script 본체: 검색 결과에서 블로그·카페 글 링크를 찾아 배지를 붙이고 점수를 채운다.
 *
 * 네이버 검색 결과의 클래스명은 자주 바뀌므로, 클래스명 대신 "블로그·카페 글 URL로 가는 링크"를 기준으로
 * 결과를 찾는다. 같은 글을 가리키는 링크(썸네일, 제목, 본문 요약) 중 텍스트가 가장 긴 것을 기준으로 삼는다.
 */
import { BADGE_TAG, createBadge, stateFromResult, type Badge } from './badge';
import { parseBlogPostUrl, parseCafeArticleUrl } from './naver';
import type { FeedbackLabel, ScoreResult, SnippetItem } from './types';

const PROCESSED = 'data-acf';
const MIN_TITLE_LENGTH = 4;
// 링크마다 들어 있는 스크린리더용 문구
const NEW_WINDOW = /새 창 열림/g;
const linkText = (a: Element) => (a.textContent ?? '').replace(NEW_WINDOW, '').trim();

export interface ScannerDeps {
  scores(urls: string[]): Promise<ScoreResult[]>;
  /** 카페 글처럼 수집할 수 없는 글을 검색 결과의 제목·요약문으로 판정 */
  snippetScores(items: SnippetItem[]): Promise<ScoreResult[]>;
  feedback(url: string, label: FeedbackLabel): Promise<void>;
  pollIntervalMs?: number;
  maxPolls?: number;
}

interface Target {
  key: string;
  kind: 'blog' | 'cafe';
  url: string;
  /** 텍스트가 가장 긴 링크 (보통 요약문) */
  anchor: HTMLAnchorElement;
  /** 두 번째로 긴 링크 텍스트 (보통 제목) */
  title: string;
}

export function findTargets(root: ParentNode): Target[] {
  const groups = new Map<string, { kind: Target['kind']; anchors: HTMLAnchorElement[] }>();
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (anchor.closest(BADGE_TAG)) continue;
    const blog = parseBlogPostUrl(anchor.href);
    const ref = blog ?? parseCafeArticleUrl(anchor.href);
    if (!ref || linkText(anchor).length < MIN_TITLE_LENGTH) continue;
    const group = groups.get(ref.key) ?? { kind: blog ? 'blog' : 'cafe', anchors: [] };
    group.anchors.push(anchor);
    groups.set(ref.key, group);
  }
  // 배지가 붙어 있는 글은 제외. 표시를 링크가 아니라 배지에 두어서, 페이지가 다시 렌더링하며
  // 배지만 지운 경우에도 다음 스캔에서 다시 붙는다.
  const done = new Set(
    [...root.querySelectorAll(`${BADGE_TAG}[${PROCESSED}]`)].map((b) => b.getAttribute(PROCESSED)),
  );
  return [...groups.entries()]
    .filter(([key]) => !done.has(key))
    .map(([key, { kind, anchors }]) => {
      // 정렬은 안정적이라 길이가 같으면 문서 순서상 앞의 링크가 남는다.
      const [main, second] = [...anchors].sort((a, b) => linkText(b).length - linkText(a).length) as [
        HTMLAnchorElement,
        HTMLAnchorElement?,
      ];
      return { key, kind, url: main.href, anchor: main, title: linkText(second ?? main) };
    });
}

export class Scanner {
  private badges = new Map<string, Badge[]>(); // url → 배지들
  private pollIntervalMs: number;
  private maxPolls: number;
  private observer?: MutationObserver;
  private scanTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private doc: Document,
    private deps: ScannerDeps,
  ) {
    this.pollIntervalMs = deps.pollIntervalMs ?? 2500;
    this.maxPolls = deps.maxPolls ?? 8;
  }

  start(): void {
    void this.scan();
    // 무한 스크롤, 탭 전환 등으로 결과가 추가되면 다시 스캔 (300ms 디바운스)
    this.observer = new MutationObserver(() => {
      clearTimeout(this.scanTimer);
      this.scanTimer = setTimeout(() => void this.scan(), 300);
    });
    this.observer.observe(this.doc.body, { childList: true, subtree: true });
  }

  stop(): void {
    this.observer?.disconnect();
    clearTimeout(this.scanTimer);
  }

  async scan(): Promise<void> {
    const targets = findTargets(this.doc);
    if (!targets.length) return;

    for (const { url, anchor, key } of targets) {
      const badge = createBadge(this.doc, (label) => this.deps.feedback(url, label));
      badge.element.setAttribute(PROCESSED, key);
      badge.update({ kind: 'loading' });
      // 가장 긴 링크는 보통 본문 요약이라, 그 앞에 두면 제목 바로 아래에 보인다 (요약이 없으면 제목 앞).
      anchor.insertAdjacentElement('beforebegin', badge.element);
      this.badges.set(url, [...(this.badges.get(url) ?? []), badge]);
    }
    const blogs = targets.filter((t) => t.kind === 'blog').map((t) => t.url);
    const cafes = targets.filter((t) => t.kind === 'cafe');
    await Promise.all([
      blogs.length && this.fetchAndRender(blogs, 0),
      cafes.length && this.renderSnippets(cafes),
    ]);
  }

  /** 카페 글은 서버가 바로 계산하므로 재조회 없이 한 번에 결과를 받는다. */
  private async renderSnippets(targets: Target[]): Promise<void> {
    const items = targets.map((t) => ({ url: t.url, title: t.title, snippet: linkText(t.anchor) }));
    let results: ScoreResult[];
    try {
      results = await this.deps.snippetScores(items);
    } catch {
      this.render(items.map((i) => i.url), { kind: 'error' });
      return;
    }
    for (const r of results) for (const b of this.badges.get(r.url) ?? []) b.update(stateFromResult(r));
  }

  private async fetchAndRender(urls: string[], attempt: number): Promise<void> {
    let results: ScoreResult[];
    try {
      results = await this.deps.scores(urls);
    } catch {
      this.render(urls, { kind: 'error' });
      return;
    }

    const pending: string[] = [];
    for (const r of results) {
      if (r.status === 'pending') pending.push(r.url);
      else for (const b of this.badges.get(r.url) ?? []) b.update(stateFromResult(r));
    }

    if (!pending.length) return;
    if (attempt + 1 >= this.maxPolls) {
      this.render(pending, { kind: 'error' });
      return;
    }
    setTimeout(() => void this.fetchAndRender(pending, attempt + 1), this.pollIntervalMs);
  }

  private render(urls: string[], state: Parameters<Badge['update']>[0]): void {
    for (const url of urls) for (const b of this.badges.get(url) ?? []) b.update(state);
  }
}
