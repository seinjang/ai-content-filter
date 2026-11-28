import { describe, expect, it } from 'vitest';
import { parseBlogPostUrl, parseCafeArticleUrl } from '@/lib/naver';

describe('parseBlogPostUrl', () => {
  it.each([
    'https://blog.naver.com/abc_12/223456789012',
    'https://m.blog.naver.com/abc_12/223456789012',
    'https://blog.naver.com/abc_12/223456789012/',
    'https://blog.naver.com/PostView.naver?blogId=abc_12&logNo=223456789012',
    'https://m.blog.naver.com/PostView.nhn?blogId=abc_12&logNo=223456789012&from=search',
    // 클릭 추적 링크 안에 실제 주소가 들어 있는 경우
    'https://m.search.naver.com/p/crd/rd?m=1&u=https%3A%2F%2Fblog.naver.com%2Fabc_12%2F223456789012',
  ])('parses %s', (url) => {
    expect(parseBlogPostUrl(url)).toEqual({
      blogId: 'abc_12',
      logNo: '223456789012',
      key: 'abc_12/223456789012',
    });
  });

  it.each([
    'https://blog.naver.com/abc_12',
    'https://blog.naver.com/abc/not-a-number',
    'https://blog.naver.com.evil.com/abc/1',
    'https://evil.com/?u=https%3A%2F%2Fevil.com%2F%3Fu%3Dhttps%253A%252F%252Fblog.naver.com%252Fa%252F1',
    'javascript:alert(1)',
    'not a url',
  ])('rejects %s', (url) => {
    expect(parseBlogPostUrl(url)).toBeNull();
  });
});

describe('parseCafeArticleUrl', () => {
  it.each([
    'https://cafe.naver.com/ksm60111/12345?art=ZXh0ZXJuYWw',
    'https://m.cafe.naver.com/ksm60111/12345',
    'https://cafe.naver.com/ksm60111/12345/',
  ])('parses %s', (url) => {
    expect(parseCafeArticleUrl(url)).toEqual({ cafe: 'ksm60111', articleId: '12345', key: 'cafe:ksm60111/12345' });
  });

  it.each([
    'https://cafe.naver.com/ksm60111',
    'https://cafe.naver.com/ksm60111/not-a-number',
    'https://cafe.naver.com.evil.com/ksm60111/12345',
    'https://blog.naver.com/ksm60111/12345',
    'not a url',
  ])('rejects %s', (url) => {
    expect(parseCafeArticleUrl(url)).toBeNull();
  });
});
