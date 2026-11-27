from datetime import datetime, timedelta, timezone

import pytest

from app.parsers import FeedPost, PostContent, parse_feed, parse_post
from app.scorer import level_for, score_blog
from app.signals import (
    category_entropy,
    extract_blog_signals,
    is_affiliate,
    keyword_density,
    posts_per_day,
    template_heading_score,
    title_similarity,
)
from tests.helpers import fixture

KST = timezone(timedelta(hours=9))
NOW = datetime(2025, 11, 28, 0, 0, tzinfo=KST)


def feed_post(days_ago: float, title: str = "제목", category: str | None = None) -> FeedPost:
    return FeedPost(
        log_no=1, title=title, category=category, published_at=NOW - timedelta(days=days_ago)
    )


class TestPostsPerDay:
    def test_feed_covering_full_window(self):
        posts = [feed_post(d) for d in range(0, 30, 3)]  # 10개, 가장 오래된 글은 27일 전
        assert posts_per_day(posts, NOW) == pytest.approx(10 / 27)

    def test_truncated_feed_uses_its_own_span(self):
        posts = [feed_post(i * 0.1) for i in range(100)]  # 10일 동안 100개
        assert posts_per_day(posts, NOW) == pytest.approx(10, rel=0.05)

    def test_burst_on_one_day_is_not_overstated(self):
        posts = [feed_post(0.1), feed_post(0.2)]
        assert posts_per_day(posts, NOW) == pytest.approx(2 / 7)

    def test_old_posts_are_ignored(self):
        assert posts_per_day([feed_post(40)], NOW) == 0


def test_category_entropy():
    assert category_entropy([feed_post(0, category="카페")] * 4) == 0
    spread = [feed_post(0, category=c) for c in "ABCDEFGH"]
    assert category_entropy(spread) == pytest.approx(3.0)
    assert category_entropy([feed_post(0)]) == 0


def test_title_similarity_detects_templates():
    templated = [
        feed_post(0, f"2025 {k} 추천 순위 TOP {n} 총정리")
        for k, n in [("노트북", 10), ("선크림", 8), ("유산균", 5)]
    ]
    personal = [
        feed_post(0, t)
        for t in ["망원동 로스터리에서", "비 오는 날 연남동 골목", "한강 자전거 탄 일요일"]
    ]
    assert title_similarity(templated) > 0.6
    assert title_similarity(personal) < 0.3
    assert title_similarity(templated[:1]) == 0


def test_post_level_signals():
    template = parse_post(fixture("post_template.html"))
    personal = parse_post(fixture("post_personal.html"))

    assert is_affiliate(template) and not is_affiliate(personal)
    assert is_affiliate(PostContent(title="", paragraphs=["소정의 수수료를 받습니다"]))
    assert keyword_density(template) > 0.1 > keyword_density(personal)
    assert template_heading_score(template) == 1.0
    assert template_heading_score(personal) == 0.0


def blog_signals(rss: str, post_html: str) -> dict:
    feed = parse_feed(fixture(rss))
    return extract_blog_signals(feed.posts, [parse_post(fixture(post_html))], NOW)


def test_template_blog_scores_high_with_reasons():
    signals = blog_signals("rss_template_blog.xml", "post_template.html")
    score, reasons = score_blog(signals)

    assert signals["posts_per_day_30d"] > 4
    assert level_for(score) == "high"
    assert reasons[0].startswith("최근 30일 하루 평균")
    assert any("제휴 링크" in r for r in reasons)
    assert len(reasons) <= 4


def test_personal_blog_scores_low():
    signals = blog_signals("rss_personal_blog.xml", "post_personal.html")
    score, reasons = score_blog(signals)

    assert level_for(score) == "low"
    assert score == 0
    assert reasons == ["직접 경험을 담은 표현이 자주 등장 (감점 요인)"]


def test_low_score_hides_risk_reasons():
    # 실제 공식 블로그 사례: 주제는 넓지만 경험 글이 많아 점수 0
    signals = {"category_entropy": 2.57, "personal_marker_ratio": 0.8}
    score, reasons = score_blog(signals)
    assert score == 0
    assert reasons == ["직접 경험을 담은 표현이 자주 등장 (감점 요인)"]


def test_score_is_bounded_and_handles_missing_signals():
    assert score_blog({}) == (0, [])
    maxed = {
        "posts_per_day_30d": 50,
        "affiliate_ratio": 1,
        "title_similarity": 1,
        "template_heading_score": 1,
        "category_entropy": 10,
        "keyword_density": 1,
    }
    assert score_blog(maxed)[0] == 100


@pytest.mark.parametrize(
    ("score", "level"), [(0, "low"), (39, "low"), (40, "medium"), (69, "medium"), (70, "high")]
)
def test_level_boundaries(score, level):
    assert level_for(score) == level
