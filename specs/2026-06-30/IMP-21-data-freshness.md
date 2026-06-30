# 기능: 폴링 화면 데이터 신선도 인디케이터

## 목적
Dashboard·Gpu·Traffic·Sessions 가 10~15s 간격으로 조용히 폴링하지만 '마지막 갱신 N초 전' 같은 신선도 표시가 없다(틱 갱신 상대시간·stale 배지 부재). 온콜이 멈춘 화면을 라이브로 오인하면 대응 지연 — Grafana/Datadog 은 갱신 시각+stale 배지를 표준 제공.

## 요구사항 / 함수 시그니처
- `web/src/components/DataFreshness.tsx` 신설(무의존):
  - props `{ updatedAt: number | null; intervalMs: number }`.
  - 1초 틱으로 상대시간 갱신("방금/N초 전/N분 전"). 절대 타임스탬프(HH:MM:SS)는 `title` 병기(상대 단독 모호 해소).
  - "· 자동 {N}s"(폴링 주기) 병기.
  - stale 판정: `age > intervalMs * 3` → "⚠ 오래됨" 배지(색 비의존 — 아이콘+텍스트, WCAG 1.4.1), `role=status aria-live=polite` 로 전환 고지.
  - 기존 `.updated` 클래스 재사용(시각 일관).
- 폴링 4개 화면(Dashboard:15s·Gpu:15s·Traffic:10s·Sessions)에 적용:
  - 성공 fetch 시 `lastLoaded = Date.now()` 상태 기록.
  - page-head 의 기존 `업데이트 …`/정적 표기를 `<DataFreshness>` 로 교체(없으면 추가).
- 수동 새로고침은 각 화면 기존 버튼 유지(중복 추가 안 함).
- follow-up(이번 범위 밖, 백로그 유지): visibilitychange 폴링 일시정지/재개, IMP-16 실패 누적과 stale 결합, IMP-8 SWR 의 dataUpdatedAt 직결.

## 테스트 케이스
- normal: 갱신 직후 "방금/N초 전" 표시, 1초마다 증가.
- stale: 주기×3 초과 무갱신 → "⚠ 오래됨" 배지 + aria-live 고지.
- a11y: 배지가 색 단독 아님(아이콘+텍스트), 절대시각 title 병기.
- visual: page-head 레이아웃 깨지지 않음(시각 QA, 앱 구동).

## 출력 위치
- `web/src/components/DataFreshness.tsx`(신규), `web/src/index.css`(`.freshness-stale`), Dashboard/Gpu/Traffic/Sessions page-head.

## 의존성
- 없음.
