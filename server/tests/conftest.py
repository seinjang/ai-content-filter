"""테스트는 실제 PostgreSQL과 Redis를 사용한다 (CI에서는 서비스 컨테이너).

기본값: postgres@localhost/acf_test, Redis DB 15. 환경변수로 덮어쓸 수 있다.
"""

import asyncio
import os

os.environ.setdefault("ACF_DATABASE_URL", "postgresql+asyncpg://postgres@localhost:5432/acf_test")
os.environ.setdefault("ACF_REDIS_URL", "redis://localhost:6379/15")

import pytest  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import create_async_engine  # noqa: E402

from app.config import settings  # noqa: E402
from app.db import Base  # noqa: E402
from app.main import app  # noqa: E402


def pytest_sessionstart(session):
    async def reset_schema():
        engine = create_async_engine(settings.database_url)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
        await engine.dispose()

    asyncio.run(reset_schema())


@pytest.fixture
async def client():
    async with app.router.lifespan_context(app):
        await app.state.redis.flushdb()
        async with app.state.sessionmaker() as s:
            tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
            await s.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
            await s.commit()
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            yield c


@pytest.fixture
def redis():
    return app.state.redis


@pytest.fixture
def sessionmaker():
    return app.state.sessionmaker
