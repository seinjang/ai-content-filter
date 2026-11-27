"""네이버 블로그 수집 클라이언트.

- 호스트별 최소 요청 간격(rate limit)을 지킨다.
- 429/5xx/네트워크 오류는 지수 백오프로 재시도하고, 404는 BlogUnavailable로 바로 알린다.
"""

import asyncio
import time
from urllib.parse import urlsplit

import httpx

from app.config import settings
from app.parsers import Feed, PostContent, parse_feed, parse_post

USER_AGENT = "ai-content-filter/0.1 (+https://github.com/seinjang/ai-content-filter)"
RETRY_STATUS = {429, 500, 502, 503, 504}


class BlogUnavailable(Exception):
    """삭제, 비공개 등으로 블로그나 글을 볼 수 없음."""


class CrawlError(Exception):
    pass


class HostRateLimiter:
    def __init__(self, min_interval: float):
        self.min_interval = min_interval
        self._last: dict[str, float] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    async def wait(self, host: str) -> None:
        lock = self._locks.setdefault(host, asyncio.Lock())
        async with lock:
            delay = self._last.get(host, 0) + self.min_interval - time.monotonic()
            if delay > 0:
                await asyncio.sleep(delay)
            self._last[host] = time.monotonic()


class NaverBlogClient:
    def __init__(
        self,
        http: httpx.AsyncClient,
        *,
        min_interval: float = 1.0,
        max_retries: int = 3,
        backoff_base: float = 1.0,
    ):
        self.http = http
        self.limiter = HostRateLimiter(min_interval)
        self.max_retries = max_retries
        self.backoff_base = backoff_base

    async def _get(self, url: str) -> httpx.Response:
        host = urlsplit(url).hostname or ""
        for attempt in range(self.max_retries + 1):
            await self.limiter.wait(host)
            try:
                res = await self.http.get(url, headers={"User-Agent": USER_AGENT})
            except httpx.TransportError as e:
                error: Exception = e
            else:
                if res.status_code == 404:
                    raise BlogUnavailable(url)
                if res.status_code not in RETRY_STATUS:
                    res.raise_for_status()
                    return res
                error = CrawlError(f"{res.status_code} {url}")
            if attempt < self.max_retries:
                await asyncio.sleep(self.backoff_base * 2**attempt)
        raise CrawlError(f"재시도 {self.max_retries}회 후 실패: {url}") from error

    async def fetch_feed(self, blog_id: str) -> Feed:
        res = await self._get(f"{settings.naver_rss_base}/{blog_id}.xml")
        return parse_feed(res.content)

    async def fetch_post(self, blog_id: str, log_no: int) -> PostContent:
        res = await self._get(f"{settings.naver_post_base}/{blog_id}/{log_no}")
        return parse_post(res.text)
