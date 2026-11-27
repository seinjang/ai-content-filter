"""Celery 워커.

실행: celery -A app.worker worker --loglevel=info --concurrency=2
"""

import asyncio

import httpx
from celery import Celery
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings
from app.crawler import CrawlError, NaverBlogClient
from app.pipeline import analyze_blog

celery_app = Celery("acf", broker=settings.redis_url)
celery_app.conf.update(
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_default_queue="analyze",
)


@celery_app.task(
    name="analyze_blog",
    autoretry_for=(CrawlError,),
    retry_backoff=30,
    max_retries=3,
    rate_limit="30/m",
)
def analyze_blog_task(blog_id: str) -> dict:
    return asyncio.run(_run(blog_id))


async def _run(blog_id: str) -> dict:
    # 태스크마다 이벤트 루프가 새로 생기므로 연결도 태스크 안에서 만들고 닫는다.
    engine = create_async_engine(settings.database_url, poolclass=NullPool)
    redis = Redis.from_url(settings.redis_url, decode_responses=True)
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as http:
            client = NaverBlogClient(http, min_interval=settings.crawl_min_interval_sec)
            return await analyze_blog(
                blog_id, client=client, sessionmaker=async_sessionmaker(engine), redis=redis
            )
    finally:
        await redis.aclose()
        await engine.dispose()
