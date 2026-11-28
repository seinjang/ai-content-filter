export type Level = 'low' | 'medium' | 'high';
export type ScoreStatus = 'ready' | 'pending' | 'invalid' | 'unavailable';

/** 서버 /v1/scores:batch 응답 항목 */
export interface ScoreResult {
  url: string;
  status: ScoreStatus;
  blog_id: string | null;
  score: number | null;
  level: Level | null;
  reasons: string[];
}

export type FeedbackLabel = 'spam' | 'ok';

export type Message =
  | { type: 'scores'; urls: string[] }
  | { type: 'feedback'; url: string; label: FeedbackLabel };

export type ScoresResponse = { ok: true; results: ScoreResult[] } | { ok: false; error: string };
export type FeedbackResponse = { ok: boolean; error?: string };
