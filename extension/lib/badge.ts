/**
 * 검색 결과 제목 옆에 붙는 배지. Shadow DOM으로 네이버 페이지 스타일과 격리한다.
 */
import type { FeedbackLabel, Level, ScoreResult } from './types';

export const BADGE_TAG = 'acf-badge';

type BadgeState =
  | { kind: 'loading' }
  | {
      kind: 'ready';
      level: Level;
      score: number;
      reasons: string[];
      source: 'blog' | 'cafe';
      basis: 'full' | 'snippet';
    }
  | { kind: 'unavailable' }
  | { kind: 'error' };

const LABELS: Record<Level, string> = {
  low: '양산형 의심 낮음',
  medium: '양산형 의심 보통',
  high: '양산형 의심 높음',
};

const STYLE = `
:host { all: initial; display: inline-block; align-self: flex-start; position: relative; margin: 4px 0;
  vertical-align: middle; font: 600 13px/1.4 -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; }
.chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 999px; font: inherit;
  border: 1.5px solid #c4c9d0; background: #f1f3f5; color: #444; cursor: pointer; white-space: nowrap; }
.chip:focus-visible { outline: 2px solid #3b82f6; outline-offset: 1px; }
.dot { width: 9px; height: 9px; border-radius: 50%; background: #9aa0a6; }
.low { border-color: #1e9e5a; background: #e6f4ec; color: #146c3d; } .low .dot { background: #1e9e5a; }
.medium { border-color: #e0a100; background: #fff4d6; color: #7a5600; } .medium .dot { background: #e0a100; }
.high { border-color: #d93025; background: #d93025; color: #fff; } .high .dot { background: #fff; }
.snippet { border-style: dashed; }
.basis { color: #666; font-size: 12px; margin-bottom: 4px; }
.panel { font-weight: 400; }
.loading .dot { animation: pulse 1s infinite alternate; }
@keyframes pulse { from { opacity: .3 } to { opacity: 1 } }
.panel { position: absolute; z-index: 2147483647; top: calc(100% + 6px); left: 0; width: 260px; padding: 10px 12px;
  border: 1px solid #d0d4da; border-radius: 8px; background: #fff; box-shadow: 0 4px 16px rgba(0,0,0,.12); color: #222; }
.panel[hidden] { display: none; }
.score { font-weight: 600; margin-bottom: 6px; }
ul { margin: 0 0 8px; padding-left: 16px; } li { margin: 2px 0; }
.ask { color: #666; margin-bottom: 6px; }
.actions { display: flex; gap: 6px; }
button.fb { flex: 1; padding: 4px 6px; border: 1px solid #d0d4da; border-radius: 6px; background: #f8f9fa; cursor: pointer; font: inherit; }
button.fb:hover { background: #eef0f2; }
.thanks { color: #1e9e5a; }
`;

export interface Badge {
  element: HTMLElement;
  update(state: BadgeState): void;
}

export function stateFromResult(r: ScoreResult): BadgeState {
  if (r.status === 'ready' && r.level && r.score !== null)
    return {
      kind: 'ready',
      level: r.level,
      score: r.score,
      reasons: r.reasons,
      source: r.source ?? 'blog',
      basis: r.basis ?? 'full',
    };
  if (r.status === 'unavailable') return { kind: 'unavailable' };
  if (r.status === 'pending') return { kind: 'loading' };
  return { kind: 'error' };
}

export function createBadge(doc: Document, onFeedback: (label: FeedbackLabel) => Promise<void>): Badge {
  const host = doc.createElement(BADGE_TAG);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${STYLE}</style>
    <button class="chip loading" type="button" aria-expanded="false"><span class="dot"></span><span class="label">분석 중</span></button>
    <div class="panel" role="dialog" hidden></div>`;

  const chip = root.querySelector<HTMLButtonElement>('.chip')!;
  const label = root.querySelector<HTMLSpanElement>('.label')!;
  const panel = root.querySelector<HTMLDivElement>('.panel')!;
  let state: BadgeState = { kind: 'loading' };

  // 검색 결과 링크 안에 들어가도 페이지 이동이 일어나지 않게 막는다.
  host.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  chip.addEventListener('click', () => {
    if (state.kind !== 'ready') return;
    panel.hidden = !panel.hidden;
    chip.setAttribute('aria-expanded', String(!panel.hidden));
  });

  function renderPanel(s: Extract<BadgeState, { kind: 'ready' }>) {
    const reasons = s.reasons.length
      ? `<ul>${s.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`
      : '<p class="ask">특별한 위험 신호 없음</p>';
    const snippet = s.basis === 'snippet';
    const basis = snippet
      ? '카페 글 · 검색 요약문만 분석'
      : `${s.source === 'cafe' ? '카페 글' : '블로그'} · 최근 글 분석`;
    // 피드백 API는 아직 블로그 단위라 요약문 판정에는 버튼을 두지 않는다.
    const feedback = snippet
      ? '<div class="ask">요약문만 보고 판정해 정확도가 낮을 수 있어요.</div>'
      : `<div class="ask">판정이 맞나요?</div>
      <div class="actions"><button class="fb" data-label="spam" type="button">양산형 맞음</button>
      <button class="fb" data-label="ok" type="button">양산형 아님</button></div>`;
    panel.innerHTML = `<div class="basis">${basis}</div><div class="score">의심도 ${s.score}점</div>${reasons}
      ${feedback}`;
    for (const btn of panel.querySelectorAll<HTMLButtonElement>('button.fb')) {
      btn.addEventListener('click', async () => {
        const actions = panel.querySelector('.actions')!;
        try {
          await onFeedback(btn.dataset.label as FeedbackLabel);
          actions.outerHTML = '<div class="thanks">의견 고마워요. 판정 개선에 쓸게요.</div>';
        } catch {
          actions.insertAdjacentHTML('afterend', '<div class="ask">전송 실패. 잠시 후 다시 시도해 주세요.</div>');
        }
      });
    }
  }

  return {
    element: host,
    update(next) {
      state = next;
      chip.className = 'chip';
      switch (next.kind) {
        case 'loading':
          chip.classList.add('loading');
          label.textContent = '분석 중';
          break;
        case 'ready':
          chip.classList.add(next.level);
          if (next.basis === 'snippet') chip.classList.add('snippet');
          label.textContent = LABELS[next.level] + (next.basis === 'snippet' ? ' · 요약' : '');
          chip.title = `의심도 ${next.score}점 · 클릭해서 근거 보기`;
          renderPanel(next);
          break;
        case 'unavailable':
          label.textContent = '분석 불가';
          chip.title = '삭제되었거나 비공개인 블로그';
          break;
        case 'error':
          label.textContent = '분석 실패';
          break;
      }
    },
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
