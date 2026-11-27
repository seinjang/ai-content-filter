import pytest

from app.parsers import ParseError, parse_feed, parse_post
from tests.helpers import fixture


def test_feed_parses_posts_newest_first_and_skips_broken_items():
    feed = parse_feed(fixture("rss_template_blog.xml"))

    assert feed.blog_name == "꿀정보 총정리"
    assert len(feed.posts) == 30
    first = feed.posts[0]
    assert first.log_no == 223000000030
    assert first.title == "2025 무선청소기 추천 순위 TOP 7 총정리"
    assert first.category == "가전"
    assert first.published_at.utcoffset().total_seconds() == 9 * 3600
    assert [p.published_at for p in feed.posts] == sorted(
        (p.published_at for p in feed.posts), reverse=True
    )


def test_feed_rejects_invalid_xml():
    with pytest.raises(ParseError):
        parse_feed("<html>not rss</html")
    with pytest.raises(ParseError):
        parse_feed("<rss></rss>")


def test_feed_blocks_entity_expansion():
    bomb = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><rss><channel>&a;</channel></rss>'
    with pytest.raises(Exception):  # noqa: B017 - defusedxml가 차단하는지만 확인
        parse_feed(bomb)


def test_smart_editor_post():
    post = parse_post(fixture("post_template.html"))

    assert post.title == "2025 무선청소기 추천 순위 TOP 7 총정리"
    assert post.headings == ["목차", "장점과 단점", "마무리 총정리"]
    assert post.paragraphs[0].startswith("이 포스팅은 쿠팡 파트너스")
    assert "" not in post.paragraphs
    assert post.image_urls == ["https://postfiles.pstatic.net/a.jpg"]
    assert "https://link.coupang.com/a/abc123" in post.links


def test_quotation_counts_as_body_text():
    post = parse_post(fixture("post_personal.html"))
    assert "사장님이 원두 이야기를 한참 해주셔서 즐거웠다." in post.paragraphs
    assert len(post.image_urls) == 2


def test_legacy_editor_post():
    post = parse_post(fixture("post_legacy.html"))

    assert post.title == "예전 에디터로 쓴 글"
    assert post.paragraphs == ["첫 문단입니다.", "두 번째 문단에 링크가 있습니다."]
    assert post.links == ["https://example.com"]


def test_post_without_body_raises():
    with pytest.raises(ParseError):
        parse_post("<html><body><p>로그인이 필요합니다</p></body></html>")
