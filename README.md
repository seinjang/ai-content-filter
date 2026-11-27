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

## 단계별 로드맵

1. **MVP** — 네이버 검색 결과에 블로그별 양산형 의심도 배지 (규칙 기반 + 캐싱) ← 진행 중
2. **평가셋 구축** — 200~500개 직접 라벨링
3. **ML 고도화** — 텍스트 모델, LLM 판정 추가 및 비교 실험
4. **멀티모달** — 이미지 신호(AI 생성 이미지, 재사용 이미지, 직접 촬영 여부) 추가
5. **정리** — 아키텍처, 실험 결과, 비용 분석 공유

## 문서

- [1단계 아키텍처 & 기술 스택](docs/01-stage1-architecture.md)
