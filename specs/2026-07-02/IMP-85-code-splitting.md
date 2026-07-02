# IMP-85 — 페이지 지연 로딩(code-splitting) — 40+ 페이지 eager 번들 분할

- **Type**: code (sev=medium, effort=M) · Direction 11 (perf — 코드가 늘어도 빠르게 유지)
- **Branch**: feature/evolve-cycle6-ontology-ux
- **Date**: 2026-07-02

## 배경 / 문제

`web/src/App.tsx` 가 24개 페이지(`./pages/X`)를 **정적 import** 해 단일 eager 번들에 전부 포함한다
(React.lazy/Suspense/dynamic import 0건). 코드가 계속 늘고 `mock.ts` 만 2557줄이라 초기 로드
페이로드가 선형 증가한다. 관제 콘솔은 한 번에 한 화면만 보므로 라우트 단위 분할 이득이 크다.

또 `main.tsx` 가 `installMockFetch` 를 **정적 import** 해, 실백엔드 배포(`VITE_MOCK=off`)에서도
`mock.ts`(2557줄) 전체가 부트 청크에 묶여 나간다 — 실백엔드에서는 한 줄도 실행되지 않는데도.

### BEFORE 측정(rolldown-vite v8)
```
dist/assets/index-*.js   832.69 kB │ gzip: 245.01 kB   ← 단일 JS 청크
dist/assets/index-*.css  144.80 kB │ gzip:  23.75 kB
JS 청크 수: 1
```

## 목표 / Fix (백로그 caveat 준수)

1. **라우트 레벨 분할**: `App.tsx` 의 24개 페이지 import 를 `React.lazy(() => import('./pages/X'))`
   로 전환. 라우터 아웃렛을 **단일 `<Suspense>`** 로 감싸고 fallback 은 페이지 구조와 MATCH 하는
   공통 Skeleton(제목 스트립 + KPI 카드 + 표 행) — **CLS 회피가 최상위 caveat**. 앱 셸/nav(Layout,
   ErrorBoundary, providers)는 **eager 유지**.
2. **mock.ts 부트 청크 유출 차단**: `main.tsx` 의 `installMockFetch` 정적 import →
   **call-time `await import('./api/mock')`** 로 전환(env 게이트 안에서). 실백엔드에서는
   `mock.ts` 가 부트 청크에 아예 안 들어간다. mock export 형태(named `installMockFetch`)는
   **불변** — 테스트가 동기 import 하므로 mock.ts 자체는 안 건드림.
3. **manualChunks(최소)**: 런타임 의존성 0(hand-rolled router/polling)이므로 `react`/`react-dom`
   만 안정 far-future-cache 청크(`react-vendor`)로 분리. 없는 vendor 버킷 과설계 금지.
4. **providers/root init 경량 유지**: ToastProvider/Theme/Capabilities/TimeRange 는 셸이므로 eager.
5. **(옵션) prefetch**: 지금은 미도입 — 단순 유지(nice-to-have, 과설계 금지).

## 변경 파일
- `web/src/App.tsx` — 정적 페이지 import 24개 → `React.lazy`, `pageContent` 를 단일 `<Suspense>` 로 래핑.
- `web/src/main.tsx` — `installMockFetch` 정적 import → 동적 import(env 게이트 내부), 로드 후 render.
- `web/src/components/Skeleton.tsx` — 공통 페이지 로딩 fallback `PageSkeleton` 추가(CLS-safe).
- `web/vite.config.ts` — `build.rollupOptions.output.manualChunks` 로 react-vendor 분리.

## 테스트 케이스
- 모든 라우트가 여전히 lazy 로딩 후 렌더된다(Suspense fallback → 실제 콘텐츠). 딥링크/⌘K nav 정상.
- CLS 점프 없음 — fallback 이 페이지의 대략적 구조(헤더+카드+표)를 미리 차지.
- 앱 셸/nav 는 eager — 지연 없이 즉시 렌더(fallback 은 아웃렛 영역에만).
- `mock.ts` 가 부트/셸 청크에 없다(별도 청크). 실백엔드 모드에선 로드 안 됨.
- 빌드가 per-route 청크 + `react-vendor` 청크를 생성하고 초기 eager 페이로드가 축소된다.
- 기존 테스트 전부 pass(IMP-88 격리 green 포함) — 어떤 테스트도 App 을 렌더하지 않으므로
  lazy 전환이 테스트 표면을 바꾸지 않는다(mock.ts 는 named export 그대로 동기 import 가능).

## 검증
- `npm run test` 전부 pass(isolation + drift canary green).
- `npm run build`(tsc + vite) green. AFTER 번들 크기 + 청크 수 기록, BEFORE 대비 델타 제시.

## 보안 라이트체크
- 로컬 모듈만 dynamic import(`./pages/X`, `./api/mock`) — 사용자 입력/원격 URL 아님. 안전.

## Out of scope
- prefetch-on-hover(옵션, 미도입). mock.ts 내부 파생 함수 재구조화(named export 형태 유지 — 테스트 동기 의존).
- 다른 백로그 항목.
