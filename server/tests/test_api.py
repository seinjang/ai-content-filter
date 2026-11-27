import json

from sqlalchemy import select

from app.db import Blog, Feedback
from app.main import CRAWL_REQUESTED_KEY, SCORE_KEY

POST_A1 = "https://blog.naver.com/blog_a/100"
POST_A2 = "https://m.blog.naver.com/blog_a/200"
POST_B = "https://blog.naver.com/blog_b/300"


async def test_healthz(client):
    res = await client.get("/healthz")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "db": "ok", "redis": "ok"}


async def test_uncached_blog_is_pending_and_requested(client, redis):
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
        }
    ]
    assert await redis.smembers(CRAWL_REQUESTED_KEY) == {"blog_a"}


async def test_cached_blog_is_ready_for_every_post(client, redis):
    await redis.set(SCORE_KEY.format("blog_a"), json.dumps({"score": 82, "reasons": ["r1"]}))

    res = await client.post(
        "/v1/scores:batch",
        json={"items": [{"url": POST_A1}, {"url": POST_A2}, {"url": POST_B}]},
    )

    results = res.json()["results"]
    assert [r["status"] for r in results] == ["ready", "ready", "pending"]
    assert results[0]["score"] == 82
    assert results[0]["level"] == "high"
    assert results[1]["reasons"] == ["r1"]
    assert await redis.smembers(CRAWL_REQUESTED_KEY) == {"blog_b"}


async def test_invalid_url_does_not_break_batch(client):
    res = await client.post(
        "/v1/scores:batch", json={"items": [{"url": "https://example.com/x"}, {"url": POST_B}]}
    )

    assert [r["status"] for r in res.json()["results"]] == ["invalid", "pending"]


async def test_batch_size_is_limited(client):
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
