# ai-content-filter

네이버 검색 결과에서 양산형/자동화 블로그 글을 구분해 주는 크롬 확장 + 분석 서버.

## 폴더 구조

```
ai-content-filter/
├─ docs/        설계 문서, 실험 기록
├─ extension/   크롬 확장 (TypeScript, Manifest V3)
├─ server/      API 서버 + 워커 (FastAPI, Celery)
└─ infra/       Docker Compose, 배포 설정
```

## 로컬 실행

### Docker (권장)

[Docker Desktop](https://www.docker.com/products/docker-desktop/) 설치 후:

```bash
cd infra
docker compose up --build
```

- API 문서: http://localhost:8000/docs
- 헬스체크: http://localhost:8000/healthz

DB 마이그레이션은 `migrate` 서비스가 API보다 먼저 자동으로 실행합니다.

### 서버만 직접 실행 (개발용)

[uv](https://docs.astral.sh/uv/) 필요. PostgreSQL과 Redis는 위 compose로 띄워 두고:

```bash
cd server
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload

# 다른 터미널에서 분석 워커 실행
uv run celery -A app.worker worker -Q analyze --loglevel=info
```

설정은 환경변수(`ACF_DATABASE_URL`, `ACF_REDIS_URL`) 또는 `server/.env`로 바꿀 수 있습니다.

### 테스트

실제 PostgreSQL(`acf_test` DB)과 Redis(DB 15)를 사용합니다.

```bash
cd server
uv run pytest
```

## 단계별 로드맵

1. **MVP** — 네이버 검색 결과에 블로그별 양산형 의심도 배지 (규칙 기반 + 캐싱) ← 진행 중
2. **평가셋 구축** — 200~500개 직접 라벨링
3. **ML 고도화** — 텍스트 모델, LLM 판정 추가 및 비교 실험
4. **멀티모달** — 이미지 신호(AI 생성 이미지, 재사용 이미지, 직접 촬영 여부) 추가
5. **정리** — 아키텍처, 실험 결과, 비용 분석 공유

## 문서

- [문서 목록](docs/README.md)
- [01 1단계 아키텍처](docs/01-stage1-architecture.md)
- [02 1주차: 서버 뼈대](docs/02-week1-server-skeleton.md)
- [03 2주차: 워커 파이프라인](docs/03-week2-worker-pipeline.md)
