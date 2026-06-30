# 기능: 인라인 style raw-px / 하드코딩 색을 토큰·의미론적 유틸로 수렴 (IMP-19)

## 목적
`web/src` 전역에 흩어진 인라인 `style={{}}` 중 **raw-px(숫자 리터럴 간격/타이포)** 와 **하드코딩 hex/rgba 색**은 `index.css` 의 토큰 캐스케이드(`--sp-*`, `--fs-*`, `--text-*`, `--border`)와 다크/밀도 토글을 우회한다. 동작은 1px도 바꾸지 않고, 등가의 기존 토큰/소수의 의미론적 유틸 클래스로 치환해 다크 테마·밀도 토글이 해당 지점에도 반영되도록 한다.

GitLab Pajamas 위계 준수: 프리미티브 > 의미론적 유틸 > CSS var() > (동적값만) 인라인.
**상수-토큰 유틸(.mt-1/.mb-2 류)은 만들지 않는다**(Pajamas deprecated). 반복 의도가 뚜렷한 의미론적 클래스만 추가한다.

## 요구사항
- 동작/시각 변화 0. raw-px → 등가 토큰(예: `marginTop: 16` → `var(--sp-4)`, `fontSize: 13` → `var(--fs-body)`, `fontSize: 11` → `var(--fs-xs)`, `gap: 8` → `var(--sp-2)`).
- 하드코딩 색은 반드시 `var()` 경유:
  - `color: "#8a8f98"` → `var(--text-faint)`
  - `rgba(0,0,0,0.1)`(테두리) → `var(--border)`
  - 토픽바 위 의도적 흰색(`#fff`, `rgba(255,255,255,..)`)·그림자 rgba 는 토큰 부재/의도적 고정이므로 유지(색 캐스케이드 대상 아님).
- 동적값(width %, `background: st.color`, `transform`, accentColor 등)은 인라인 유지 — 억지 클래스화 금지.
- 신규 의존성 0. 기존 `.muted`/토큰과 충돌 없는 **추가형**.
- 새 유틸은 파일 단위 atomic 적용.

## 함수 시그니처
신규 CSS 의미론적 유틸 (index.css 말미 `/* ── 의미론적 유틸 (IMP-19) ── */` 섹션):
```css
.u-label-xs { font-size: var(--fs-xs); color: var(--text-dim); }   /* 보조 라벨 */
.row        { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; }  /* 가로 정렬 줄 */
.stack-sm   { display: flex; flex-direction: column; gap: var(--sp-2); }  /* 작은 세로 스택 */
```
신규 프리미티브 컴포넌트 `web/src/components/primitives.tsx`:
```ts
export function Row(props: { className?: string; children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>): JSX.Element
export function Muted(props: { className?: string; children: React.ReactNode } & React.HTMLAttributes<HTMLSpanElement>): JSX.Element  // .muted .u-label-xs span
```

## 테스트 케이스
- `Row` 렌더: children 렌더 + `class` 에 `row` 포함 + 전달 className 병합.
- `Muted` 렌더: children 렌더 + `class` 에 `muted` 포함.
- 동작 무변경: 변환 지점은 등가 토큰 치환이라 별도 동작 테스트 없음 — tsc/lint/build green + 시각 동등성으로 보증.

## 출력 위치
- `web/src/index.css` (유틸 3종 추가)
- `web/src/components/primitives.tsx` (신규, Row/Muted)
- `web/src/components/__tests__/primitives.test.tsx` (신규)
- 변환 대상 파일(raw-px/하드코딩색): `capabilities.tsx`, `components/Skeleton.tsx`, `components/PipelineWaterfall.tsx`, `components/Layout.tsx`, `components/ViewBar.tsx`, `components/ReconfigurePanel.tsx`, `components/InspectDrawer.tsx`, `components/MaskingPolicy.tsx`, `pages/Settings.tsx`, `pages/Eval.tsx`, `pages/Credentials.tsx`, `pages/Diagnostics.tsx`, `pages/Playground.tsx`, `pages/Guard.tsx`

## 의존성
none (zero new runtime deps)
