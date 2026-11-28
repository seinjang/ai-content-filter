import json

import pytest
from sqlalchemy import select

from app.cache import LOCK_KEY, SCORE_KEY
from app.db import Blog, Feedback
from app.main import app, get_enqueue

POST_A1 = "https://blog.naver.com/blog_a/100"
POST_A2 = "https://m.blog.naver.com/blog_a/200"
POST_B = "https://blog.naver.com/blog_b/300"


@pytest.fixture
def enqueued(client):
    calls: list[list[str]] = []

    async def fake_enqueue(blog_ids):
        calls.append(blog_ids)

    app.dependency_overrides[get_enqueue] = lambda: fake_enqueue
    yield calls
    app.dependency_overrides.clear()


async def test_healthz(client):
    res = await client.get("/healthz")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "db": "ok", "redis": "ok"}


async def test_uncached_blog_is_pending_and_enqueued_once(client, redis, enqueued):
    res = await client.post("/v1/scores:batch", json={"items": [{"url": POST_A1}]})

    assert res.status_code == 200
    assert res.json()["results"] == [
        {
            "url": POST_A1,
            "status": "pending",
            "blog_id": "blog_a",
            "score": None,
            "level": None,
            "reasons": [],
            "source": "blog",
            "basis": "full",
        }
    ]
    assert enqueued == [["blog_a"]]
    assert await redis.exists(LOCK_KEY.format("blog_a"))

    # 분석이 끝나기 전에 다시 요청해도 중복 등록하지 않음
    await client.post("/v1/scores:batch", json={"items": [{"url": POST_A2}]})
    assert enqueued == [["blog_a"]]


async def test_failed_enqueue_releases_lock(client, redis):
    async def broken_enqueue(blog_ids):
        raise ConnectionError("broker down")

    app.dependency_overrides[get_enqueue] = lambda: broken_enqueue
    try:
        with pytest.raises(ConnectionError):
            await client.post("/v1/scores:batch", json={"items": [{"url": POST_A1}]})
    finally:
        app.dependency_overrides.clear()

    assert not await redis.exists(LOCK_KEY.format("blog_a"))


async def test_cached_blog_is_ready_for_every_post(client, redis, enqueued):
    cached = {"status": "ready", "score": 82, "reasons": ["r1"]}
    await redis.set(SCORE_KEY.format("blog_a"), json.dumps(cached))

    res = await client.post(
        "/v1/scores:batch",
        json={"items": [{"url": POST_A1}, {"url": POST_A2}, {"url": POST_B}]},
    )

    results = res.json()["results"]
    assert [r["status"] for r in results] == ["ready", "ready", "pending"]
    assert results[0]["score"] == 82
    assert results[0]["level"] == "high"
    assert results[1]["reasons"] == ["r1"]
    assert enqueued == [["blog_b"]]


async def test_unavailable_blog(client, redis, enqueued):
    await redis.set(SCORE_KEY.format("blog_a"), json.dumps({"status": "unavailable"}))

    res = await client.post("/v1/scores:batch", json={"items": [{"url": POST_A1}]})

    assert res.json()["results"][0]["status"] == "unavailable"
    assert enqueued == []


async def test_invalid_url_does_not_break_batch(client, enqueued):
    res = await client.post(
        "/v1/scores:batch", json={"items": [{"url": "https://example.com/x"}, {"url": POST_B}]}
    )

    assert [r["status"] for r in res.json()["results"]] == ["invalid", "pending"]


async def test_batch_size_is_limited(client, enqueued):
    items = [{"url": POST_A1}] * 31
    assert (await client.post("/v1/scores:batch", json={"items": items})).status_code == 422
    assert (await client.post("/v1/scores:batch", json={"items": []})).status_code == 422


async def test_feedback_is_stored_per_blog(client, sessionmaker):
    for url in (POST_A1, POST_A2):
        res = await client.post(
            "/v1/feedback", json={"url": url, "label": "ok", "client_id": "install-1"}
        )
        assert res.status_code == 201

    async with sessionmaker() as s:
        blogs = (await s.scalars(select(Blog))).all()
        feedback = (await s.scalars(select(Feedback))).all()

    assert [b.blog_id for b in blogs] == ["blog_a"]
    assert len(feedback) == 2
    assert all(f.target_type == "blog" and f.target_id == blogs[0].id for f in feedback)
    assert feedback[0].client_hash and feedback[0].client_hash != "install-1"


async def test_feedback_rejects_non_blog_url(client):
    res = await client.post("/v1/feedback", json={"url": "https://example.com", "label": "spam"})
    assert res.status_code == 422


async def test_feedback_rejects_unknown_label(client):
    res = await client.post("/v1/feedback", json={"url": POST_A1, "label": "maybe"})
    assert res.status_code == 422


CAFE = "https://cafe.naver.com/somecafe/12345?art=abc"


async def test_snippet_scores_cafe_article_without_caching(client, redis):
    item = {
        "url": CAFE,
        "title": "무선청소기 추천 순위 TOP 7 총정리",
        "snippet": "업체로부터 제품을 제공받아 작성 #무선청소기 #청소기추천 #가성비청소기 #살림템 "
        "#청소기순위 #무선청소기추천 #청소템 #신혼가전",
    }
    res = await client.post("/v1/snippets:score", json={"items": [item]})

    assert res.status_code == 200
    [r] = res.json()["results"]
    assert (r["status"], r["source"], r["basis"]) == ("ready", "cafe", "snippet")
    assert r["level"] == "high"
    assert "협찬·제휴 문구가 보임" in r["reasons"]
    assert await redis.dbsize() == 0  # 클라이언트가 보낸 문구로 만든 점수는 저장하지 않음


async def test_snippet_rejects_non_cafe_url(client):
    item = {"url": "https://blog.naver.com/a/1", "title": "t", "snippet": "s"}
    res = await client.post("/v1/snippets:score", json={"items": [item]})
    assert res.json()["results"][0]["status"] == "invalid"


async def test_snippet_limits_text_length(client):
    item = {"url": CAFE, "title": "t", "snippet": "x" * 2001}
    res = await client.post("/v1/snippets:score", json={"items": [item]})
    assert res.status_code == 422
