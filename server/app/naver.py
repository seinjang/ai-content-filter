"""네이버 블로그 URL 파싱.

지원 형식:
  https://blog.naver.com/{blogId}/{logNo}
  https://m.blog.naver.com/{blogId}/{logNo}
  https://blog.naver.com/PostView.naver?blogId={blogId}&logNo={logNo}  (.nhn 포함)
"""

import re
from dataclasses import dataclass
from urllib.parse import parse_qs, urlsplit

_HOSTS = {"blog.naver.com", "m.blog.naver.com"}
_BLOG_ID = re.compile(r"^[A-Za-z0-9_-]{1,50}$")
_LOG_NO = re.compile(r"^\d{1,20}$")
_POSTVIEW_PATHS = {"/PostView.naver", "/PostView.nhn"}


@dataclass(frozen=True)
class BlogPostRef:
    blog_id: str
    log_no: int


def parse_blog_post_url(url: str) -> BlogPostRef | None:
    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return None
    if parts.scheme not in ("http", "https") or (parts.hostname or "").lower() not in _HOSTS:
        return None

    if parts.path in _POSTVIEW_PATHS:
        qs = parse_qs(parts.query)
        blog_id = (qs.get("blogId") or [""])[0]
        log_no = (qs.get("logNo") or [""])[0]
    else:
        segments = [s for s in parts.path.split("/") if s]
        if len(segments) != 2:
            return None
        blog_id, log_no = segments

    if not (_BLOG_ID.match(blog_id) and _LOG_NO.match(log_no)):
        return None
    return BlogPostRef(blog_id=blog_id, log_no=int(log_no))
