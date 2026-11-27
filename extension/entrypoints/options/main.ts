import { getApiBase, setApiBase } from '@/lib/settings';

const form = document.querySelector<HTMLFormElement>('#form')!;
const input = document.querySelector<HTMLInputElement>('#apiBase')!;
const status = document.querySelector<HTMLDivElement>('#status')!;

input.value = await getApiBase();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const origin = `${new URL(input.value).origin}/*`;
  // 기본 주소(localhost) 외에는 해당 서버 권한만 그때 요청한다.
  const granted = await browser.permissions.request({ origins: [origin] });
  if (!granted) {
    status.textContent = '서버 접근 권한이 없어 저장하지 않았어요.';
    return;
  }
  await setApiBase(input.value);
  status.textContent = '저장했어요.';
});

document.querySelector('#test')!.addEventListener('click', async () => {
  status.textContent = '확인 중…';
  try {
    const res = await fetch(`${await getApiBase()}/healthz`);
    const body = (await res.json()) as { status: string };
    status.textContent = res.ok ? '서버 연결 정상' : `서버 상태: ${body.status}`;
  } catch {
    status.textContent = '서버에 연결할 수 없어요. 서버가 실행 중인지 확인해 주세요.';
  }
});
