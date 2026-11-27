"""rule v1 스코어러: 신호별 위험도(0~1)를 가중합해 0~100 점수와 근거를 만든다.

임계값과 가중치는 직관에 기반한 초기값이며, 평가셋 구축 후 조정한다.
"""

from collections.abc import Callable
from dataclasses import dataclass

SCORING_VERSION = "rule-v1"


def _ramp(x: float, low: float, high: float) -> float:
    """x <= low 이면 0, x >= high 이면 1, 사이는 선형."""
    return max(0.0, min(1.0, (x - low) / (high - low)))


@dataclass(frozen=True)
class Rule:
    signal: str
    weight: float
    low: float
    high: float
    reason: Callable[[float], str]


RULES = [
    Rule("posts_per_day_30d", 0.30, 1.0, 5.0, lambda v: f"최근 30일 하루 평균 {v:.1f}개 포스팅"),
    Rule("affiliate_ratio", 0.20, 0.0, 1.0, lambda v: f"제휴 링크가 있는 글 비율 {v:.0%}"),
    Rule(
        "title_similarity",
        0.15,
        0.30,
        0.70,
        lambda v: f"제목이 정형화된 틀을 반복 (유사도 {v:.2f})",
    ),
    Rule(
        "template_heading_score", 0.15, 0.0, 1.0, lambda v: "목차·총정리·마무리 등 템플릿형 소제목"
    ),
    Rule("category_entropy", 0.10, 1.5, 3.5, lambda v: "서로 관련 없는 주제를 폭넓게 다룸"),
    Rule(
        "keyword_density", 0.10, 0.03, 0.10, lambda v: f"제목 키워드를 본문에 과하게 반복 ({v:.2f})"
    ),
]
PERSONAL_DISCOUNT = 0.15
REASON_THRESHOLD = 0.5


def level_for(score: int) -> str:
    if score < 40:
        return "low"
    if score < 70:
        return "medium"
    return "high"


def score_blog(signals: dict) -> tuple[int, list[str]]:
    contributions = []
    for rule in RULES:
        value = signals.get(rule.signal, 0.0)
        risk = _ramp(value, rule.low, rule.high)
        contributions.append((rule.weight * risk, risk, rule, value))

    personal = signals.get("personal_marker_ratio", 0.0)
    total = sum(c for c, *_ in contributions) - PERSONAL_DISCOUNT * personal
    score = round(max(0.0, min(1.0, total)) * 100)

    reasons = [
        rule.reason(value)
        for _, risk, rule, value in sorted(contributions, key=lambda c: c[0], reverse=True)
        if risk >= REASON_THRESHOLD
    ]
    if personal >= REASON_THRESHOLD:
        reasons.append("직접 경험을 담은 표현이 자주 등장 (감점 요인)")
    return score, reasons[:4]
