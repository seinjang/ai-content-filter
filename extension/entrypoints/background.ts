import { ScoreService } from '@/lib/service';
import { getApiBase } from '@/lib/settings';
import type { FeedbackResponse, Message, ScoresResponse } from '@/lib/types';

export default defineBackground(() => {
  const service = new ScoreService({
    store: {
      get: (keys) => browser.storage.local.get(keys),
      set: (items) => browser.storage.local.set(items),
    },
    fetch: (...args) => fetch(...args),
    apiBase: getApiBase,
  });

  browser.runtime.onMessage.addListener((msg: Message) => {
    if (msg.type === 'scores') {
      return service
        .scores(msg.urls)
        .then((results): ScoresResponse => ({ ok: true, results }))
        .catch((e: unknown): ScoresResponse => ({ ok: false, error: String(e) }));
    }
    if (msg.type === 'snippetScores') {
      return service
        .snippetScores(msg.items)
        .then((results): ScoresResponse => ({ ok: true, results }))
        .catch((e: unknown): ScoresResponse => ({ ok: false, error: String(e) }));
    }
    if (msg.type === 'feedback') {
      return service
        .feedback(msg.url, msg.label)
        .then((): FeedbackResponse => ({ ok: true }))
        .catch((e: unknown): FeedbackResponse => ({ ok: false, error: String(e) }));
    }
    return undefined;
  });
});
