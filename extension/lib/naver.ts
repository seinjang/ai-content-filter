/** 네이버 블로그 글 URL 파서. 서버의 app/naver.py와 같은 규칙. */

export interface BlogPostRef {
  blogId: string;
  logNo: string;
  /** 같은 글을 가리키는 링크를 묶는 키 */
  key: string;
}

const HOSTS = new Set(['blog.naver.com', 'm.blog.naver.com']);
const POSTVIEW_PATHS = new Set(['/PostView.naver', '/PostView.nhn']);
const BLOG_ID = /^[A-Za-z0-9_-]{1,50}$/;
const LOG_NO = /^\d{1,20}$/;

export function parseBlogPostUrl(raw: string, depth = 0): BlogPostRef | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  if (!HOSTS.has(url.hostname.toLowerCase())) {
    // 검색 결과의 클릭 추적 링크처럼 실제 주소를 쿼리에 담은 경우
    if (depth > 0) return null;
    for (const value of url.searchParams.values()) {
      if (value.includes('blog.naver.com')) {
        const ref = parseBlogPostUrl(value, depth + 1);
        if (ref) return ref;
      }
    }
    return null;
  }

  let blogId: string;
  let logNo: string;
  if (POSTVIEW_PATHS.has(url.pathname)) {
    blogId = url.searchParams.get('blogId') ?? '';
    logNo = url.searchParams.get('logNo') ?? '';
  } else {
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length !== 2) return null;
    [blogId, logNo] = segments as [string, string];
  }

  if (!BLOG_ID.test(blogId) || !LOG_NO.test(logNo)) return null;
  return { blogId, logNo, key: `${blogId}/${logNo}` };
}
