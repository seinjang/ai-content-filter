from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

TARGET_TYPES = "target_type IN ('blog', 'post')"


class Base(DeclarativeBase):
    pass


class Blog(Base):
    __tablename__ = "blogs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    blog_id: Mapped[str] = mapped_column(String(50), unique=True)
    name: Mapped[str | None] = mapped_column(String(200))
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    last_crawled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Post(Base):
    __tablename__ = "posts"
    __table_args__ = (UniqueConstraint("blog_pk", "log_no"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    blog_pk: Mapped[int] = mapped_column(ForeignKey("blogs.id", ondelete="CASCADE"))
    log_no: Mapped[int] = mapped_column(BigInteger)
    title: Mapped[str | None] = mapped_column(Text)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    content_hash: Mapped[str | None] = mapped_column(String(64))
    crawled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Signal(Base):
    """신호 원본. 이후 ML 학습 feature로 재사용한다."""

    __tablename__ = "signals"
    __table_args__ = (
        CheckConstraint(TARGET_TYPES, name="signals_target_type"),
        Index("ix_signals_target", "target_type", "target_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    target_type: Mapped[str] = mapped_column(String(10))
    target_id: Mapped[int] = mapped_column(BigInteger)
    payload: Mapped[dict] = mapped_column(JSONB)
    extractor_version: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Score(Base):
    __tablename__ = "scores"
    __table_args__ = (
        CheckConstraint(TARGET_TYPES, name="scores_target_type"),
        CheckConstraint("score BETWEEN 0 AND 100", name="scores_range"),
        Index("ix_scores_target", "target_type", "target_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    target_type: Mapped[str] = mapped_column(String(10))
    target_id: Mapped[int] = mapped_column(BigInteger)
    score: Mapped[int] = mapped_column(SmallInteger)
    reasons: Mapped[list] = mapped_column(JSONB)
    scoring_version: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Feedback(Base):
    __tablename__ = "feedback"
    __table_args__ = (
        CheckConstraint(TARGET_TYPES, name="feedback_target_type"),
        CheckConstraint("label IN ('spam', 'ok')", name="feedback_label"),
        Index("ix_feedback_target", "target_type", "target_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    target_type: Mapped[str] = mapped_column(String(10))
    target_id: Mapped[int] = mapped_column(BigInteger)
    client_hash: Mapped[str | None] = mapped_column(String(64))
    label: Mapped[str] = mapped_column(String(10))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
