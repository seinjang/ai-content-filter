import hashlib
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from redis.asyncio import Redis
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.db import Blog, Feedback
from app.naver import parse_blog_post_url

# 점수는 블로그 단위로 캐시한다. 값: {"score": int, "reasons": [str]}
SCORE_KEY = "score:blog:{}"
# 분석 요청된 블로그 ID. 2주차 워커(Celery)가 이 집합을 소비한다.
CRAWL_REQUESTED_KEY = "crawl:requested"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    app.state.sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
    app.state.redis = Redis.from_url(settings.redis_url, decode_responses=True)
    yield
    await app.state.redis.aclose()
    await engine.dispose()


app = FastAPI(title="ai-content-filter", version="0.1.0", lifespan=lifespan)


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.sessionmaker() as session:
        yield session


def get_redis(request: Request) -> Redis:
    return request.app.state.redis


SessionDep = Annotated[AsyncSession, Depends(get_session)]
RedisDep = Annotated[Redis, Depends(get_redis)]


def level_for(score: int) -> Literal["low", "medium", "high"]:
    if score < 40:
        return "low"
    if score < 70:
        return "medium"
    return "high"


# --- health ---------------------------------------------------------------


@app.get("/healthz")
async def healthz(session: SessionDep, redis: RedisDep, response: Response) -> dict:
    checks = {}
    try:
        await session.execute(text("SELECT 1"))
        checks["db"] = "ok"
    except Exception:
        checks["db"] = "error"
    try:
        await redis.ping()
        checks["redis"] = "ok"
    except Exception:
        checks["redis"] = "error"

    healthy = all(v == "ok" for v in checks.values())
    if not healthy:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {"status": "ok" if healthy else "degraded", **checks}


# --- scores ---------------------------------------------------------------


class ScoreRequestItem(BaseModel):
    url: str = Field(max_length=2048)


class ScoreBatchRequest(BaseModel):
    items: list[ScoreRequestItem] = Field(min_length=1, max_length=settings.max_batch_size)


class ScoreResult(BaseModel):
    url: str
    status: Literal["ready", "pending", "invalid"]
    blog_id: str | None = None
    score: int | None = None
    level: Literal["low", "medium", "high"] | None = None
    reasons: list[str] = []


class ScoreBatchResponse(BaseModel):
    results: list[ScoreResult]


@app.post("/v1/scores:batch")
async def score_batch(body: ScoreBatchRequest, redis: RedisDep) -> ScoreBatchResponse:
    refs = [parse_blog_post_url(item.url) for item in body.items]
    blog_ids = sorted({ref.blog_id for ref in refs if ref})

    cached: dict[str, dict] = {}
    if blog_ids:
        values = await redis.mget([SCORE_KEY.format(b) for b in blog_ids])
        cached = {b: json.loads(v) for b, v in zip(blog_ids, values, strict=True) if v}
        missing = [b for b in blog_ids if b not in cached]
        if missing:
            await redis.sadd(CRAWL_REQUESTED_KEY, *missing)

    results = []
    for item, ref in zip(body.items, refs, strict=True):
        if ref is None:
            results.append(ScoreResult(url=item.url, status="invalid"))
        elif hit := cached.get(ref.blog_id):
            results.append(
                ScoreResult(
                    url=item.url,
                    status="ready",
                    blog_id=ref.blog_id,
                    score=hit["score"],
                    level=level_for(hit["score"]),
                    reasons=hit.get("reasons", []),
                )
            )
        else:
            results.append(ScoreResult(url=item.url, status="pending", blog_id=ref.blog_id))
    return ScoreBatchResponse(results=results)


# --- feedback -------------------------------------------------------------


class FeedbackRequest(BaseModel):
    url: str = Field(max_length=2048)
    label: Literal["spam", "ok"]
    client_id: str | None = Field(default=None, max_length=200)


@app.post("/v1/feedback", status_code=status.HTTP_201_CREATED)
async def create_feedback(body: FeedbackRequest, session: SessionDep) -> dict:
    ref = parse_blog_post_url(body.url)
    if ref is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "네이버 블로그 글 URL이 아닙니다"
        )

    await session.execute(
        insert(Blog).values(blog_id=ref.blog_id).on_conflict_do_nothing(index_elements=["blog_id"])
    )
    blog_pk = await session.scalar(select(Blog.id).where(Blog.blog_id == ref.blog_id))
    client_hash = hashlib.sha256(body.client_id.encode()).hexdigest() if body.client_id else None
    feedback = Feedback(
        target_type="blog", target_id=blog_pk, client_hash=client_hash, label=body.label
    )
    session.add(feedback)
    await session.commit()
    return {"id": feedback.id}
