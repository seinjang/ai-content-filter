"""블로그 1개 분석: 수집 → 신호 추출 → 점수 → 저장 → 캐시."""

import hashlib
import json
import logging
from datetime import UTC, datetime

from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.cache import LOCK_KEY, SCORE_KEY
from app.config import settings
from app.crawler import BlogUnavailable, NaverBlogClient
from app.db import Blog, Post, Score, Signal
from app.parsers import ParseError, PostContent
from app.scorer import SCORING_VERSION, score_blog
from app.signals import EXTRACTOR_VERSION, extract_blog_signals

log = logging.getLogger(__name__)


async def analyze_blog(
    blog_id: str,
    *,
    client: NaverBlogClient,
    sessionmaker: async_sessionmaker,
    redis: Redis,
    now: datetime | None = None,
) -> dict:
    """일시적 오류(CrawlError)는 그대로 올려 Celery가 재시도하게 한다.

    이때 락은 풀지 않아 재시도 중 중복 등록을 막고, 재시도가 모두 실패하면 TTL로 풀린다.
    """
    now = now or datetime.now(UTC)
    try:
        result = await _analyze(blog_id, client, sessionmaker, redis, now)
    except BlogUnavailable:
        result = {"status": "unavailable"}
        await redis.set(
            SCORE_KEY.format(blog_id), json.dumps(result), ex=settings.unavailable_cache_ttl_sec
        )
    await redis.delete(LOCK_KEY.format(blog_id))
    return result


async def _analyze(blog_id, client, sessionmaker, redis, now) -> dict:
    feed = await client.fetch_feed(blog_id)
    if not feed.posts:
        raise BlogUnavailable(f"글이 없는 블로그: {blog_id}")

    samples: dict[int, PostContent] = {}
    for post in feed.posts[: settings.sample_posts]:
        try:
            samples[post.log_no] = await client.fetch_post(blog_id, post.log_no)
        except (BlogUnavailable, ParseError) as e:
            log.info("글 건너뜀 %s/%s: %s", blog_id, post.log_no, e)

    signals = extract_blog_signals(feed.posts, list(samples.values()), now)
    score, reasons = score_blog(signals)

    async with sessionmaker() as s:
        await s.execute(
            insert(Blog)
            .values(blog_id=blog_id, name=feed.blog_name, last_crawled_at=now)
            .on_conflict_do_update(
                index_elements=["blog_id"],
                set_={"name": feed.blog_name, "last_crawled_at": now},
            )
        )
        blog_pk = await s.scalar(select(Blog.id).where(Blog.blog_id == blog_id))
        for post in feed.posts[: settings.sample_posts]:
            content = samples.get(post.log_no)
            values = {
                "blog_pk": blog_pk,
                "log_no": post.log_no,
                "title": post.title,
                "posted_at": post.published_at,
                "content_hash": _hash(content.text) if content else None,
                "crawled_at": now if content else None,
            }
            await s.execute(
                insert(Post)
                .values(**values)
                .on_conflict_do_update(index_elements=["blog_pk", "log_no"], set_=values)
            )
        s.add(
            Signal(
                target_type="blog",
                target_id=blog_pk,
                payload=signals,
                extractor_version=EXTRACTOR_VERSION,
            )
        )
        s.add(
            Score(
                target_type="blog",
                target_id=blog_pk,
                score=score,
                reasons=reasons,
                scoring_version=SCORING_VERSION,
            )
        )
        await s.commit()

    result = {"status": "ready", "score": score, "reasons": reasons}
    await redis.set(SCORE_KEY.format(blog_id), json.dumps(result), ex=settings.score_cache_ttl_sec)
    return result


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()
