from pathlib import Path

import httpx

FIXTURES = Path(__file__).parent / "fixtures"


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def fake_naver(routes: dict[str, str | int]) -> httpx.AsyncClient:
    """URL → 본문(str) 또는 상태 코드(int). 등록되지 않은 URL은 404."""

    def handler(request: httpx.Request) -> httpx.Response:
        body = routes.get(str(request.url), 404)
        if isinstance(body, int):
            return httpx.Response(body)
        return httpx.Response(200, text=body)

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))
