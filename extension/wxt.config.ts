import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: '양산형 블로그 필터',
    description: '네이버 검색 결과에서 양산형·자동화 블로그 글에 의심도 배지를 붙입니다.',
    permissions: ['storage'],
    host_permissions: ['http://localhost:8000/*', 'http://127.0.0.1:8000/*'],
    // 옵션에서 다른 API 서버 주소를 지정하면 그때 해당 주소 권한만 요청한다.
    optional_host_permissions: ['https://*/*', 'http://*/*'],
  },
});
