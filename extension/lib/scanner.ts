/**
 * content script 본체: 검색 결과에서 블로그 글 링크를 찾아 배지를 붙이고 점수를 채운다.
 *
 * 네이버 검색 결과의 클래스명은 자주 바뀌므로, 클래스명 대신 "블로그 글 URL로 가는 링크"를 기준으로
 * 결과를 찾는다. 같은 글을 가리키는 링크(썸네일, 제목, 본문 요약) 중 텍스트가 가장 긴 것을 기준으로 삼는다.
 */
import { BADGE_TAG, createBadge, stateFromResult, type Badge } from './badge';
import { parseBlogPostUrl } from './naver';
import type { FeedbackLabel, ScoreResult } from './types';

const PROCESSED = 'data-acf';
const MIN_TITLE_LENGTH = 4;

export interface ScannerDeps {
  scores(urls: string[]): Promise<ScoreResult[]>;
  feedback(url: string, label: FeedbackLabel): Promise<void>;
  pollIntervalMs?: number;
  maxPolls?: number;
}

interface Target {
  url: string;
  anchor: HTMLAnchorElement;
}

export function findTargets(root: ParentNode): Target[] {
  const best = new Map<string, Target>();
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (anchor.closest(BADGE_TAG)) continue;
    const ref = parseBlogPostUrl(anchor.href);
    if (!ref) continue;
    const text = anchor.textContent?.trim() ?? '';
    if (text.length < MIN_TITLE_LENGTH) continue;
    const current = best.get(ref.key);
    if (!current || text.length > (current.anchor.textContent?.trim().length ?? 0)) {
      best.set(ref.key, { url: anchor.href, anchor });
    }
  }
  // 배지가 붙어 있는 글은 제외. 표시를 링크가 아니라 배지에 두어서, 페이지가 다시 렌더링하며
  // 배지만 지운 경우에도 다음 스캔에서 다시 붙는다.
  const done = new Set(
    [...root.querySelectorAll(`${BADGE_TAG}[${PROCESSED}]`)].map((b) => b.getAttribute(PROCESSED)),
  );
  return [...best.entries()].filter(([key]) => !done.has(key)).map(([, t]) => t);
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

    for (const { url, anchor } of targets) {
      const badge = createBadge(this.doc, (label) => this.deps.feedback(url, label));
      badge.element.setAttribute(PROCESSED, parseBlogPostUrl(url)!.key);
      badge.update({ kind: 'loading' });
      // 가장 긴 링크는 보통 본문 요약이라, 그 앞에 두면 제목 바로 아래에 보인다 (요약이 없으면 제목 앞).
      anchor.insertAdjacentElement('beforebegin', badge.element);
      this.badges.set(url, [...(this.badges.get(url) ?? []), badge]);
    }
    await this.fetchAndRender(targets.map((t) => t.url), 0);
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
