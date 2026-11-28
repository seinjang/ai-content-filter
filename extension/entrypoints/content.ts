import { Scanner } from '@/lib/scanner';
import type { FeedbackResponse, Message, ScoresResponse } from '@/lib/types';

export default defineContentScript({
  matches: ['https://search.naver.com/*', 'https://m.search.naver.com/*'],
  runAt: 'document_idle',
  main() {
    const send = <T>(msg: Message) => browser.runtime.sendMessage(msg) as Promise<T>;

    new Scanner(document, {
      async scores(urls) {
        const res = await send<ScoresResponse>({ type: 'scores', urls });
        if (!res.ok) throw new Error(res.error);
        return res.results;
      },
      async snippetScores(items) {
        const res = await send<ScoresResponse>({ type: 'snippetScores', items });
        if (!res.ok) throw new Error(res.error);
        return res.results;
      },
      async feedback(url, label) {
        const res = await send<FeedbackResponse>({ type: 'feedback', url, label });
        if (!res.ok) throw new Error(res.error);
      },
    }).start();
  },
});
