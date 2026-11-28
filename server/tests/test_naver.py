import pytest

from app.naver import BlogPostRef, CafeArticleRef, parse_blog_post_url, parse_cafe_article_url


@pytest.mark.parametrize(
    "url",
    [
        "https://blog.naver.com/abc_12/223456789012",
        "https://m.blog.naver.com/abc_12/223456789012",
        "http://blog.naver.com/abc_12/223456789012/",
        "https://blog.naver.com/PostView.naver?blogId=abc_12&logNo=223456789012",
        "https://m.blog.naver.com/PostView.nhn?blogId=abc_12&logNo=223456789012&from=search",
        "  https://BLOG.naver.com/abc_12/223456789012  ",
    ],
)
def test_parses_supported_formats(url):
    assert parse_blog_post_url(url) == BlogPostRef("abc_12", 223456789012)


@pytest.mark.parametrize(
    "url",
    [
        "https://blog.naver.com/abc_12",  # 블로그 홈
        "https://blog.naver.com/abc_12/not-a-number",
        "https://blog.naver.com/abc/123/extra",
        "https://blog.naver.com/PostView.naver?blogId=abc",  # logNo 없음
        "https://evil.com/abc_12/223456789012",
        "https://blog.naver.com.evil.com/abc_12/223456789012",
        "ftp://blog.naver.com/abc_12/223456789012",
        "https://tistory.com/abc/1",
        "not a url",
        "",
    ],
)
def test_rejects_other_urls(url):
    assert parse_blog_post_url(url) is None


@pytest.mark.parametrize(
    "url",
    [
        "https://cafe.naver.com/ksm60111/12345?art=ZXh0ZXJuYWw",
        "https://m.cafe.naver.com/ksm60111/12345",
        "https://cafe.naver.com/ksm60111/12345/",
    ],
)
def test_parses_cafe_article(url):
    assert parse_cafe_article_url(url) == CafeArticleRef("ksm60111", 12345)


@pytest.mark.parametrize(
    "url",
    [
        "https://cafe.naver.com/ksm60111",  # 카페 홈
        "https://cafe.naver.com/ksm60111/not-a-number",
        "https://cafe.naver.com.evil.com/ksm60111/12345",
        "https://blog.naver.com/ksm60111/12345",
        "not a url",
    ],
)
def test_rejects_non_cafe_article(url):
    assert parse_cafe_article_url(url) is None
