from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ACF_", env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/acf"
    redis_url: str = "redis://localhost:6379/0"
    max_batch_size: int = 30

    score_cache_ttl_sec: int = 60 * 60 * 24 * 3
    unavailable_cache_ttl_sec: int = 60 * 60
    crawl_min_interval_sec: float = 1.0
    sample_posts: int = 5
    naver_rss_base: str = "https://rss.blog.naver.com"
    naver_post_base: str = "https://m.blog.naver.com"


settings = Settings()
