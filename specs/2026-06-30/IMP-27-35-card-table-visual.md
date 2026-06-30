# IMP-27 / IMP-35 — 카드 elevation·KPI 위계 + 테이블 밀도·정돈

분류: 미적(aesthetic) 백로그. 사람이 PR 에서 시각 리뷰. 의존성: 없음(none).
언어 유지: 엔터프라이즈 라이트 + 스틸블루. 네온 금지. 기존 토큰 재사용, 신규 런타임 의존 0.

---

## IMP-27 — 대시보드 카드·KPI 시각 깊이·위계

### 목적
`.card` 의 평상시 그림자가 `0 1px 2px rgba(16,24,40,.04)` 로 극미약해 카드가 배경에
거의 붙어 보인다. KPI 빅넘버/단위/델타/라벨이 같은 무게로 경쟁해 위계가 약하다.
스파크라인이 라벨과 시각적으로 충돌한다. Linear/Vercel 식 "절제된 깊이 + 강한
타입 위계" 로 끌어올리되 라이트+스틸블루 톤 유지.

### 요구사항
1. **Elevation 토큰 재설계**
   - `--shadow-card`: 평상시에도 또렷한 1단 그림자(엠비언트 + 미세 키 라이트).
     라이트 테마 기준 `0 1px 2px rgba(16,24,40,.06), 0 1px 1px rgba(16,24,40,.04)` 수준의
     "읽히는" 깊이. (다크 테마 토큰도 동반 상향.)
   - `--shadow-card-hover`: 더 또렷한 lift(블러/오프셋 ↑). 평상↔hover 대비가 느껴지게.
   - `.card` radius/패딩 리듬 정돈은 기존 `--radius`/`--sp-4` 유지(리듬은 이미 정합) —
     hover 시 `border-color` 강조는 유지.
2. **KPI 타입 위계** (`.metric`)
   - 빅넘버(`.num`) 무게 ↑(700 유지, letter-spacing 더 타이트하게 -0.02em 유지/대비 확인).
   - 단위(`.unit`) 디엠퍼사이즈: 더 작게/연하게(`--text-faint`, weight 500).
   - 델타(`.delta`)를 작은 **pill** 로 분리: 배경 틴트(good=green-weak, bad=red-weak,
     flat=중립) + 라운드, 빅넘버 옆에서 줄바꿈 없이.
   - 라벨(`.lbl`) letter-spacing 약간 + 대비(`--text-dim` 유지, 대문자화 금지 — 한글 라벨).
3. **스파크라인 격하**
   - 메트릭 카드 하단에 **풀블리드 미니 배경**으로 격하: 라벨 아래가 아니라 메트릭 블록
     하단에 옅게 깔리는 보조 추세. 기존처럼 라벨과 같은 흐름으로 끼지 않게.
   - 구현은 CSS 위주 + StatCard 마크업 소폭(델타 pill 래핑, 스파크 위치) 조정.
     `Delta` 컴포넌트 동작·aria-label 보존(IMP 접근성 회귀 금지).

### 테스트
- StatCard: 델타 pill 이 `.delta.good`/`.delta.bad`/`.delta.flat` 클래스로 렌더되는지
  (기존 aria-label 유지 확인). 단위 span 렌더. 스파크라인 존재 시 sparkline 렌더.
- 빅넘버 값/단위 분리 렌더(unit prop).

### 출력 위치
- `web/src/index.css`: `:root`/dark `--shadow-card`·`--shadow-card-hover`, `.metric .num/.unit/.lbl`,
  `.metric .num .delta*`, 스파크라인 배치.
- `web/src/components/StatCard.tsx`: 델타 pill 래핑 + 스파크 위치 마크업.
- `web/src/pages/Dashboard.tsx`: 변경 불요(메트릭 prop 그대로). 회귀만 방지.

---

## IMP-35 — 데이터 테이블 시각 밀도·정돈

### 목적
`Keys`·`Guard`·`Sessions`·`Traces` 공통 `.usage-table` 의 스캔성·정돈을 Linear/Datadog
수준으로. IMP-30(VirtualRows windowing)·IMP-3(정렬 헤더)·IMP-17(table-scroll)·밀도
토글을 회귀시키지 않고 그 위에 시각 레이어만 강화.

### 요구사항
1. **스티키 thead** — `.vrow-viewport` 세로 스크롤 시 헤더가 상단 고정.
   `position: sticky; top: 0` + 배경/하단 보더. `sticky-first` 1열 고정과 z-index 정합
   (헤더-1열 교차 셀이 둘 다 위로). VirtualRows 스페이서 `<tr>` 와 충돌 없게.
2. **절제된 zebra + 행 hover** — 짝수행 극미세 틴트(`--surface-2` 보다 더 옅게/동등),
   hover 는 기존 `--surface-2` 유지하되 zebra 와 hover 가 동시에 자연스럽게.
   `clickable` 행 hover(`--primary-weak`)·선택 행(`row-sel`) 우선순위 보존.
3. **정렬 활성 컬럼 정합(IMP-3)** — `th.sortable.active` 에 더해 활성 정렬 컬럼의
   `<td>` 에도 옅은 배경, 화살표(▲▼)는 이미 button 내. 활성 헤더 셀 배경도 살짝.
   (열 단위 강조는 CSS `:has()` 의존 없이 — 현재 마크업은 td 에 컬럼 식별 클래스가
   없으므로 헤더 강조 + 정렬 button 강조로 한정. 과도한 마크업 변경 회피.)
4. **숫자 컬럼** — `td.num`/`th.num` 우정렬 + `font-variant-numeric: tabular-nums`(기존
   유지) 확인. 누락 페이지 없게 점검.
5. **일관 셀 패딩(밀도 연동)** — 기본/compact/relaxed 패딩이 thead/tbody 일관. 스티키
   헤더 추가 후에도 밀도 토글 패딩 유효.
6. **빈/로딩 행 폴리시** — `.empty`(카드 내 빈 상태)·로딩 톤 일관. 테이블 빈 상태는
   기존 `.empty` 사용(회귀 금지). 신규: 로딩/빈 행이 테이블 폭을 유지하도록 가이드만
   (마크업은 페이지별 기존 패턴 유지 — CSS 강제 변경 없음).

### 테스트
- 순수 CSS 변경이 대부분. 로직 추가 없음 → StatCard 테스트로 커버. 테이블은 마크업
  무변경(스티키는 CSS) 이므로 스냅샷/RTL 신규 테스트 불요. 기존 테스트 회귀만 확인.

### 출력 위치
- `web/src/index.css`: `.usage-table thead th`(sticky), zebra(`tbody tr:nth-child`),
  `th.sortable.active`(헤더 배경), 밀도 토글 패딩 정합.

### 의존성
없음. 신규 런타임 의존 0. IMP-30/IMP-3/IMP-17/밀도토글 회귀 금지.
