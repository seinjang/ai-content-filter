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
  source?: 'blog' | 'cafe';
  /** full: 수집한 글로 판정, snippet: 검색 결과의 제목·요약문만으로 판정 */
  basis?: 'full' | 'snippet';
}

/** 수집할 수 없는 글(카페)을 검색 결과 문구로 판정할 때 보내는 항목 */
export interface SnippetItem {
  url: string;
  title: string;
  snippet: string;
}

export type FeedbackLabel = 'spam' | 'ok';

export type Message =
  | { type: 'scores'; urls: string[] }
  | { type: 'snippetScores'; items: SnippetItem[] }
  | { type: 'feedback'; url: string; label: FeedbackLabel };

export type ScoresResponse = { ok: true; results: ScoreResult[] } | { ok: false; error: string };
export type FeedbackResponse = { ok: boolean; error?: string };
