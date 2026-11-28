"""블로그 단위 신호 계산. 모두 순수 함수라 저장된 원본으로 언제든 다시 계산할 수 있다."""

import math
import re
from collections import Counter
from datetime import datetime, timedelta
from difflib import SequenceMatcher
from itertools import combinations

from app.parsers import FeedPost, PostContent

EXTRACTOR_VERSION = "signals-v1"

AFFILIATE_DOMAINS = (
    "link.coupang.com",
    "coupa.ng",
    "link.tenping.kr",
    "ali.ski",
    "s.click.aliexpress",
)
AFFILIATE_PHRASES = ("파트너스 활동", "수수료를 제공받", "소정의 수수료", "제휴 마케팅")
TEMPLATE_HEADINGS = (
    "목차",
    "결론",
    "마무리",
    "총정리",
    "요약",
    "장점",
    "단점",
    "자주 묻는 질문",
    "FAQ",
)
PERSONAL_MARKERS = re.compile(
    r"다녀왔|다녀온|먹어 ?봤|써 ?봤|사봤|직접 (가|해|써|먹|사)"
    r"|제가 |저는 |저희 |우리 (아이|집|가족)|남편|와이프"
)
_DIGITS = re.compile(r"\d+")
TITLE_SAMPLE = 20


def posts_per_day(posts: list[FeedPost], now: datetime, days: int = 30, min_span: int = 7) -> float:
    """최근 days일 동안의 하루 평균 글 수.

    RSS는 최근 글 일부만 주므로, 피드가 기간 전체를 덮지 못하면 가장 오래된 글부터의 기간으로
    나눈다. 하루에 몰아 쓴 경우를 과대평가하지 않도록 분모는 최소 min_span일.
    """
    since = now - timedelta(days=days)
    recent = [p for p in posts if p.published_at >= since]
    if not recent:
        return 0.0
    span_days = (now - min(p.published_at for p in recent)).total_seconds() / 86400
    return len(recent) / max(min_span, min(days, span_days))


def category_entropy(posts: list[FeedPost]) -> float:
    """카테고리 분포의 섀넌 엔트로피(bit). 주제가 넓게 흩어질수록 크다."""
    counts = Counter(p.category for p in posts if p.category)
    total = sum(counts.values())
    if total == 0:
        return 0.0
    return -sum(c / total * math.log2(c / total) for c in counts.values())


def title_similarity(posts: list[FeedPost]) -> float:
    """최근 제목끼리의 평균 유사도. 숫자를 지워 '2025 OO 가격 총정리' 같은 틀을 잡아낸다."""
    titles = [_DIGITS.sub("0", p.title) for p in posts[:TITLE_SAMPLE] if p.title]
    pairs = list(combinations(titles, 2))
    if not pairs:
        return 0.0
    return sum(SequenceMatcher(None, a, b).ratio() for a, b in pairs) / len(pairs)


def is_affiliate(post: PostContent) -> bool:
    if any(d in link for link in post.links for d in AFFILIATE_DOMAINS):
        return True
    return any(p in post.text for p in AFFILIATE_PHRASES)


def keyword_density(post: PostContent) -> float:
    return _keyword_density(post.title, post.text)


def _keyword_density(title: str, text: str) -> float:
    """제목 단어가 본문에 반복되는 정도 (본문 어절 수 대비 등장 횟수)."""
    keywords = {w for w in title.split() if len(w) >= 2}
    words = text.split()
    if not keywords or not words:
        return 0.0
    return sum(text.count(k) for k in keywords) / len(words)


def template_heading_score(post: PostContent) -> float:
    hits = sum(1 for h in post.headings if any(t in h for t in TEMPLATE_HEADINGS))
    return min(1.0, hits / 3)


def has_personal_markers(post: PostContent) -> bool:
    return bool(PERSONAL_MARKERS.search(post.text))


SPONSORED_PHRASES = (*AFFILIATE_PHRASES, "협찬", "원고료", "제공받아", "업체로부터", "지원받아")
TEMPLATE_TITLE = re.compile(
    r"총정리|TOP ?\d|BEST ?\d|추천 ?순위|가격 ?비교|비교 ?정리", re.IGNORECASE
)
_HASHTAG = re.compile(r"#[^\s#]+")


def extract_snippet_signals(title: str, snippet: str) -> dict:
    """검색 결과의 제목·요약문만으로 계산하는 글 단위 신호. 카페 글처럼 수집할 수 없는 글에 쓴다."""
    text = f"{title} {snippet}"
    return {
        "hashtag_count": len(_HASHTAG.findall(snippet)),
        "sponsored": float(any(p in text for p in SPONSORED_PHRASES)),
        "template_title": float(bool(TEMPLATE_TITLE.search(title))),
        "keyword_density": round(_keyword_density(title, snippet), 3),
        "personal_marker_ratio": float(bool(PERSONAL_MARKERS.search(text))),
    }


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def extract_blog_signals(
    feed_posts: list[FeedPost], samples: list[PostContent], now: datetime
) -> dict:
    return {
        "feed_post_count": len(feed_posts),
        "sample_count": len(samples),
        "posts_per_day_30d": round(posts_per_day(feed_posts, now), 3),
        "category_entropy": round(category_entropy(feed_posts), 3),
        "title_similarity": round(title_similarity(feed_posts), 3),
        "affiliate_ratio": round(_mean([float(is_affiliate(s)) for s in samples]), 3),
        "keyword_density": round(_mean([keyword_density(s) for s in samples]), 3),
        "template_heading_score": round(_mean([template_heading_score(s) for s in samples]), 3),
        "personal_marker_ratio": round(_mean([float(has_personal_markers(s)) for s in samples]), 3),
        "avg_image_count": round(_mean([float(len(s.image_urls)) for s in samples]), 1),
        "avg_text_length": round(_mean([float(len(s.text)) for s in samples]), 1),
    }
