/**
 * 실제 Chrome에 빌드한 확장을 올려 검색 결과 흉내 페이지에서 배지가 붙는지 확인한다.
 *
 * 준비: API 서버(127.0.0.1:8000)와 Celery 워커 실행, `npm run build`
 * 빌드 결과를 임시 폴더에 복사한 뒤, 로컬 테스트 페이지(127.0.0.1)에도 content script가 돌도록 manifest만 고친다.
 * 실행: CHROME_PATH=/path/to/chrome npm run e2e
 */
import { createServer } from 'node:http';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = await mkdtemp(path.join(tmpdir(), 'acf-e2e-'));
await cp(path.resolve(here, '../.output/chrome-mv3'), extensionPath, { recursive: true });
const manifestPath = path.join(extensionPath, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
for (const cs of manifest.content_scripts) cs.matches.push('http://127.0.0.1/*');
await writeFile(manifestPath, JSON.stringify(manifest));
const page = await readFile(path.join(here, 'search-page.html'));

const server = createServer((_, res) => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page));
await new Promise((r) => server.listen(5500, '127.0.0.1', r));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  headless: true,
  pipe: true,
  enableExtensions: [extensionPath],
  args: ['--no-sandbox', '--no-proxy-server'],
});

try {
  const tab = await browser.newPage();
  await tab.setViewport({ width: 900, height: 640 });
  await tab.goto('http://127.0.0.1:5500/', { waitUntil: 'load' });

  const labels = () =>
    tab.$$eval('acf-badge', (els) => els.map((e) => e.shadowRoot.querySelector('.label').textContent));

  await tab.waitForFunction(() => document.querySelectorAll('acf-badge').length > 0, { timeout: 10_000 });
  console.log('첫 표시:', await labels());
  await tab.waitForFunction(
    () => [...document.querySelectorAll('acf-badge')].every((e) => e.shadowRoot.querySelector('.label').textContent !== '분석 중'),
    { timeout: 90_000, polling: 500 },
  );
  const final = await labels();
  console.log('최종:', final);

  // 첫 배지를 눌러 근거 패널 열기
  await tab.evaluate(() => document.querySelector('acf-badge').shadowRoot.querySelector('.chip').click());
  const panel = await tab.evaluate(() => document.querySelector('acf-badge').shadowRoot.querySelector('.panel').innerText);
  console.log('패널:', panel.replace(/\n+/g, ' | '));
  await tab.screenshot({ path: path.join(here, 'screenshot.png') });

  // 피드백 전송 → 서버 저장까지
  await tab.evaluate(() =>
    document.querySelector('acf-badge').shadowRoot.querySelector('button[data-label="ok"]').click(),
  );
  await tab.waitForFunction(
    () => document.querySelector('acf-badge').shadowRoot.querySelector('.thanks'),
    { timeout: 10_000 },
  );
  console.log('피드백 전송 완료');

  const expected = ['양산형 의심', '양산형 의심', '분석 불가'];
  const ok = final.length === 3 && final.every((l, i) => l.startsWith(expected[i]));
  if (!ok) throw new Error(`예상과 다른 결과: ${JSON.stringify(final)}`);
  console.log('E2E 통과');
} finally {
  await browser.close();
  server.close();
}
