"""네이버 블로그 RSS와 모바일 글 페이지 파싱.

- RSS: https://rss.blog.naver.com/{blogId}.xml
- 글: https://m.blog.naver.com/{blogId}/{logNo} (스마트에디터 ONE 구조, 구 에디터는 #postViewArea)
"""

import re
from dataclasses import dataclass, field
from datetime import datetime
from email.utils import parsedate_to_datetime

from defusedxml import ElementTree
from selectolax.lexbor import LexborHTMLParser as HTMLParser

from app.naver import parse_blog_post_url

_WS = re.compile(r"\s+")


def _clean(text: str | None) -> str:
    return _WS.sub(" ", text or "").strip()


@dataclass(frozen=True)
class FeedPost:
    log_no: int
    title: str
    category: str | None
    published_at: datetime


@dataclass(frozen=True)
class Feed:
    blog_name: str | None
    posts: list[FeedPost]


@dataclass(frozen=True)
class PostContent:
    title: str
    paragraphs: list[str] = field(default_factory=list)
    headings: list[str] = field(default_factory=list)
    image_urls: list[str] = field(default_factory=list)
    links: list[str] = field(default_factory=list)

    @property
    def text(self) -> str:
        return "\n".join(self.paragraphs)


class ParseError(Exception):
    pass


def parse_feed(xml: bytes | str) -> Feed:
    try:
        root = ElementTree.fromstring(xml)
    except ElementTree.ParseError as e:
        raise ParseError(f"RSS 파싱 실패: {e}") from e
    channel = root.find("channel")
    if channel is None:
        raise ParseError("RSS에 channel이 없음")

    posts = []
    for item in channel.findall("item"):
        ref = parse_blog_post_url(item.findtext("guid") or "") or parse_blog_post_url(
            (item.findtext("link") or "").split("?")[0]
        )
        pub = item.findtext("pubDate")
        if ref is None or not pub:
            continue
        try:
            published_at = parsedate_to_datetime(pub)
        except (TypeError, ValueError):
            continue
        posts.append(
            FeedPost(
                log_no=ref.log_no,
                title=_clean(item.findtext("title")),
                category=_clean(item.findtext("category")) or None,
                published_at=published_at,
            )
        )
    posts.sort(key=lambda p: p.published_at, reverse=True)
    return Feed(blog_name=_clean(channel.findtext("title")) or None, posts=posts)


def parse_post(html: str) -> PostContent:
    tree = HTMLParser(html)
    container = tree.css_first("div.se-main-container")
    if container is not None:
        return _parse_smart_editor(tree, container)
    legacy = tree.css_first("#postViewArea")
    if legacy is not None:
        return _parse_legacy(tree, legacy)
    raise ParseError("본문 영역을 찾지 못함")


def _parse_smart_editor(tree: HTMLParser, container) -> PostContent:
    title_node = tree.css_first(".se-title-text")
    headings, paragraphs = [], []
    for comp in container.css("div.se-component"):
        classes = comp.attributes.get("class") or ""
        texts = [_clean(p.text()) for p in comp.css("p.se-text-paragraph")]
        texts = [t for t in texts if t]
        if "se-sectionTitle" in classes:
            headings.extend(texts)
        elif "se-text" in classes or "se-quotation" in classes:
            paragraphs.extend(texts)
    return PostContent(
        title=_clean(title_node.text()) if title_node else "",
        paragraphs=paragraphs,
        headings=headings,
        image_urls=_images(container),
        links=_links(container),
    )


def _parse_legacy(tree: HTMLParser, area) -> PostContent:
    title_node = tree.css_first(".pcol1, .se_title, h3.tit_h3")
    nodes = area.css("p") or [area]
    paragraphs = [t for p in nodes if (t := _clean(p.text()))]
    return PostContent(
        title=_clean(title_node.text()) if title_node else "",
        paragraphs=paragraphs,
        image_urls=_images(area),
        links=_links(area),
    )


def _images(node) -> list[str]:
    urls = []
    for img in node.css("img"):
        src = img.attributes.get("data-lazy-src") or img.attributes.get("src")
        if src and not src.startswith("data:"):
            urls.append(src)
    return urls


def _links(node) -> list[str]:
    return [href for a in node.css("a[href]") if (href := a.attributes.get("href"))]
