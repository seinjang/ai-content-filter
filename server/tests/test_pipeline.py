import json
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.cache import LOCK_KEY, SCORE_KEY
from app.crawler import CrawlError, NaverBlogClient
from app.db import Blog, Post, Score, Signal
from app.pipeline import analyze_blog
from tests.helpers import fake_naver, fixture

NOW = datetime(2025, 11, 28, 0, 0, tzinfo=timezone(timedelta(hours=9)))
RSS = "https://rss.blog.naver.com/{}.xml"
POST = "https://m.blog.naver.com/{}/{}"


def template_blog_routes(**overrides) -> dict:
    routes = {RSS.format("info_bot"): fixture("rss_template_blog.xml")}
    for log_no in range(223000000026, 223000000031):
        routes[POST.format("info_bot", log_no)] = fixture("post_template.html")
    routes.update(overrides)
    return routes


async def run(routes, sessionmaker, redis, blog_id="info_bot"):
    async with fake_naver(routes) as http:
        client = NaverBlogClient(http, min_interval=0, backoff_base=0)
        return await analyze_blog(
            blog_id, client=client, sessionmaker=sessionmaker, redis=redis, now=NOW
        )


async def count(sessionmaker, model) -> int:
    async with sessionmaker() as s:
        return await s.scalar(select(func.count()).select_from(model))


async def test_template_blog_is_scored_saved_and_cached(client, sessionmaker, redis):
    await redis.set(LOCK_KEY.format("info_bot"), "1")

    result = await run(template_blog_routes(), sessionmaker, redis)

    assert result["status"] == "ready"
    assert result["score"] >= 70
    assert json.loads(await redis.get(SCORE_KEY.format("info_bot"))) == result
    assert 0 < await redis.ttl(SCORE_KEY.format("info_bot")) <= 3 * 86400
    assert not await redis.exists(LOCK_KEY.format("info_bot"))

    async with sessionmaker() as s:
        blog = await s.scalar(select(Blog))
        posts = (await s.scalars(select(Post))).all()
        signal = await s.scalar(select(Signal))
        score = await s.scalar(select(Score))
    assert (blog.blog_id, blog.name) == ("info_bot", "꿀정보 총정리")
    assert len(posts) == 5 and all(p.content_hash for p in posts)
    assert signal.payload["sample_count"] == 5
    assert (score.score, score.scoring_version) == (result["score"], "rule-v1")


async def test_unreadable_posts_are_skipped(client, sessionmaker, redis):
    routes = template_blog_routes(
        **{
            POST.format("info_bot", 223000000030): 404,
            POST.format("info_bot", 223000000029): "<html><body>로그인 필요</body></html>",
        }
    )

    result = await run(routes, sessionmaker, redis)

    assert result["status"] == "ready"
    async with sessionmaker() as s:
        signal = await s.scalar(select(Signal))
        hashed = await s.scalar(select(func.count()).where(Post.content_hash.is_not(None)))
    assert signal.payload["sample_count"] == 3
    assert hashed == 3


async def test_missing_blog_is_cached_as_unavailable(client, sessionmaker, redis):
    await redis.set(LOCK_KEY.format("gone"), "1")

    result = await run({}, sessionmaker, redis, blog_id="gone")

    assert result == {"status": "unavailable"}
    assert json.loads(await redis.get(SCORE_KEY.format("gone"))) == result
    assert 0 < await redis.ttl(SCORE_KEY.format("gone")) <= 3600
    assert not await redis.exists(LOCK_KEY.format("gone"))
    assert await count(sessionmaker, Blog) == 0


async def test_transient_failure_keeps_lock_for_retry(client, sessionmaker, redis):
    await redis.set(LOCK_KEY.format("info_bot"), "1")

    with pytest.raises(CrawlError):
        await run({RSS.format("info_bot"): 503}, sessionmaker, redis)

    assert await redis.exists(LOCK_KEY.format("info_bot"))
    assert not await redis.exists(SCORE_KEY.format("info_bot"))


async def test_reanalysis_updates_rows_and_keeps_score_history(client, sessionmaker, redis):
    await run(template_blog_routes(), sessionmaker, redis)
    await run(template_blog_routes(), sessionmaker, redis)

    assert await count(sessionmaker, Blog) == 1
    assert await count(sessionmaker, Post) == 5
    assert await count(sessionmaker, Score) == 2
