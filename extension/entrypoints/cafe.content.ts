import { BADGE_TAG, createBadge, stateFromResult } from '@/lib/badge';
import { cafeArticleUrl, extractArticle } from '@/lib/cafe';
import type { ArticleResponse, Message } from '@/lib/types';

/** 사용자가 연 카페 글을 본문으로 판정해 글 제목 옆에 배지를 붙인다. */
export default defineContentScript({
  matches: ['https://cafe.naver.com/*'],
  allFrames: true,
  runAt: 'document_idle',
  main() {
    // 본문은 cafe_main iframe 안에만 있다.
    if (window === window.top) return;
    let scored = '';

    const run = async () => {
      const url = cafeArticleUrl(window.top!.location.href, location.href);
      if (!url || url === scored) return;
      const item = extractArticle(document, url);
      if (!item) return;
      scored = url;

      document.querySelector(BADGE_TAG)?.remove(); // 같은 iframe에서 다른 글로 넘어간 경우
      const badge = createBadge(document, async () => {});
      badge.update({ kind: 'loading' });
      const title = document.querySelector('.ArticleTitle .title_text') ?? document.querySelector('.title_text');
      if (title) title.insertAdjacentElement('afterend', badge.element);
      else document.querySelector('.se-main-container')!.prepend(badge.element);

      const res = (await browser.runtime.sendMessage({ type: 'articleScore', item } satisfies Message)) as ArticleResponse;
      badge.update(res.ok ? stateFromResult(res.result) : { kind: 'error' });
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => void run(), 300);
    }).observe(document.body, { childList: true, subtree: true });
    void run();
  },
});
