import time

import httpx
import pytest

from app.crawler import BlogUnavailable, CrawlError, HostRateLimiter, NaverBlogClient

URL = "https://m.blog.naver.com/a/1"


def client_with(responses: list[int | Exception]) -> tuple[NaverBlogClient, list[str]]:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.headers["User-Agent"])
        item = responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return httpx.Response(item, text="ok")

    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return NaverBlogClient(http, min_interval=0, backoff_base=0), calls


async def test_retries_transient_errors_then_succeeds():
    client, calls = client_with([503, httpx.ConnectError("boom"), 429, 200])
    res = await client._get(URL)
    assert res.status_code == 200
    assert len(calls) == 4
    assert calls[0].startswith("ai-content-filter/")


async def test_gives_up_after_max_retries():
    client, calls = client_with([500] * 4)
    with pytest.raises(CrawlError):
        await client._get(URL)
    assert len(calls) == 4


async def test_404_is_unavailable_without_retry():
    client, calls = client_with([404])
    with pytest.raises(BlogUnavailable):
        await client._get(URL)
    assert len(calls) == 1


async def test_other_4xx_is_not_retried():
    client, calls = client_with([403])
    with pytest.raises(httpx.HTTPStatusError):
        await client._get(URL)
    assert len(calls) == 1


async def test_rate_limiter_spaces_requests_per_host():
    limiter = HostRateLimiter(min_interval=0.05)
    start = time.monotonic()
    for _ in range(3):
        await limiter.wait("m.blog.naver.com")
    await limiter.wait("rss.blog.naver.com")  # 다른 호스트는 기다리지 않음
    assert 0.1 <= time.monotonic() - start < 0.2
