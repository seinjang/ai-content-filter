import pytest

from app.naver import BlogPostRef, parse_blog_post_url


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
