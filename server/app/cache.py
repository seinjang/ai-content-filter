"""Redis 키 규칙.

score:blog:{blogId}   블로그 점수 캐시
  {"status": "ready", "score": 72, "reasons": [...]}  또는  {"status": "unavailable"}
lock:analyze:{blogId} 분석 중복 실행 방지 락. API가 잡고, 워커가 끝나면 푼다.
"""

SCORE_KEY = "score:blog:{}"
LOCK_KEY = "lock:analyze:{}"
LOCK_TTL_SEC = 600
