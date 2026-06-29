# FABRIX Endpoint — UI/UX 개선 추적표 (코드 갭 분석 기반)

> **목적**: [agent-바이브코딩-UIUX-트렌드-2026.md](agent-바이브코딩-UIUX-트렌드-2026.md) 의 패턴 대비, **web/src 전 프론트엔드 코드를 실제로 읽고** 파일별 현재 상태·갭·할 일을 1:1로 추적. 이 표를 보며 수정 진행.
> **작성**: 2026-06-28 · 분석 방식: 전 파일(.tsx/.ts/.css, 8,560줄) 직접 읽기 + 라인 근거.
> **상태 범례**: ☐ 미착수 · ◐ 진행중 · ☑ 완료 · ✓현재구현됨(유지) · — 해당없음
> **우선순위**: **P1**(핵심 가시성/관측성, 즉시) · **P2**(편의·일관성) · **P3**(고도화/백엔드 의존)

---

## ⚠ 0. 먼저 합의할 전제 2가지

| # | 발견 | 결정 필요 |
|---|------|-----------|
| **A. 색상 정체성 불일치** | 메모리·문서엔 "라이트+오렌지(Backend.AI)"라 적혀 있으나 **실제 코드 `index.css` 의 `--primary` 는 스틸블루 `#4a86b8`(MAYMUST)**. 오렌지 `#fb6e00` 는 `capabilities.tsx` BootScreen 에만 사용. 상단바도 파랑 그라데이션. | 어느 쪽이 정답인지 확정 → 본 표의 "톤" 관련 항목이 여기 의존. (현 분석은 코드 현실=스틸블루 기준) |
| **B. 데이터 소스** | 다수 화면이 mock 우선. 추론지표(TPOT)·분산 트레이스·disagg/agg 라우팅은 **백엔드/victoria-traces 수집 후 활성화** 주석 다수. | P3 항목은 백엔드 선행 필요 — 프론트는 "필드 오면 렌더" 자리만 잡기. |

---

## 1. 전역/공통 (Layout · CommandPalette · capabilities · index.css · Skeleton)

| ID | 파일 | 패턴(§) | 현재 상태 | 할 일 (구체) | 우선 | 상태 |
|----|------|---------|-----------|--------------|------|------|
| G-01 | `CommandPalette.tsx` | ⌘K 팔레트(§4) | ✓ 자체구현: ⌘K·즉시타이핑·↑↓·Enter·Esc·fuzzy·그룹(이동/작업/설정)·capabilities 게이팅 모두 있음 | (선택) `cmdk` 마이그레이션은 보류. **마우스용 닫기(X) 버튼 추가**(현재 오버레이 클릭만, §4 체크리스트 위반) | P2 | ☐ |
| G-02 | `CommandPalette.tsx` | 대량 항목 가상화(§4) | ◐ `filtered.map()` 전체 렌더(가상화 없음) | 명령 수 많아지면 TanStack Virtual 적용. 현재 규모면 보류 | P3 | ☐ |
| G-03 | `CommandPalette.tsx` | 자연어 질의 진입(§5·§7.3) | absent | ⌘K 에 "질문하기" 모드 — Static 생성형 UI(§5.5)로 차트 호출. **백엔드 선행** | P3 | ☐ |
| G-04 | `index.css` | 라이트 토큰·임계색(§0·§2.3) | ✓ green#15803d/amber#b45309/red#c81e1e/pink#be185d 정의, 8pt 스케일, focus-visible, prefers-reduced-motion | 전제 A 확정 후 `--primary` 정체성 정리. 임계 3단색은 이미 우수 — 유지 | P1 | ☐ |
| G-05 | `Layout.tsx` | 글로벌 시간범위(§3.4) | absent — 시간범위가 각 페이지에 분산 | **공유 시간범위 컨텍스트**(React Context)로 끌어올려 전 대시보드 위젯 동기화 | P1 | ☐ |
| G-06 | `Layout.tsx`·`capabilities.tsx` | 역할 적응(§3.1) | ✓ `useCap().can()` + visibleNav 필터 + "관제 전용" 배지 + manage 페일오픈 | 유지. observe 에서 실수 시도 방지 가드만 보강 | P2 | ☐ |
| G-07 | `Skeleton.tsx` | 로딩 상태(§6.2 queued) | ✓ shimmer 1.4s + sr-only aria-live | 유지. (펄싱은 불필요 — shimmer 로 충분) | ✓ | — |
| G-08 | `Badge.tsx`·`Alarms.tsx` | 상태/심각도(§6.4) | ✓ statusTone 자동분류 + 기호(●▲ℹ)+색 이중화(색맹 대응) | 유지 — 모범 사례 | ✓ | — |

---

## 2. 대시보드군 (Dashboard · Usage · Traffic · Gpu + 차트 컴포넌트)

| ID | 파일 | 패턴(§) | 현재 상태 | 할 일 (구체) | 우선 | 상태 |
|----|------|---------|-----------|--------------|------|------|
| D-01 | `Dashboard.tsx` | 벤토 비대칭(§2.1) | ◐ `.cards-4` 균일 4열 + `.grid-2`. 비대칭 타일 없음 | 12컬럼 그리드로 전환. **좌상단 hero 타일(span 6×2)에 최critical 지표**, 우측 2×2 상태. KPI는 span 3×4 | P2 | ☐ |
| D-02 | `Dashboard.tsx` | KPI anatomy(§2.3) | ✓ StatCard = 값+delta화살표+spark+tone 완비 | 유지 — anatomy 모범 | ✓ | — |
| D-03 | `Dashboard.tsx` | 인지부하 3개(§3.2) | ✓ 기본 4카드 + 관제뷰 패널 토글(localStorage) | 기본 노출을 **3개로** 줄이고 4번째+는 "더 보기"(§3.2 검증규칙) | P2 | ☐ |
| D-04 | `Dashboard.tsx` | 추론지표 노출(§2.5) | ◐ TTFT p95 만. TPOT/tok·s 없음 | KPI 카드에 TPOT·tok/s 추가(필드 오면). **TTFT/TPOT 를 1급 KPI 로** | P1 | ☐ |
| D-05 | `Usage.tsx` | 마스터-디테일(§3.3) | ◐ 세그먼트/행 클릭→SlidePanel 상세 O, **필터 역연동 X** | SlidePanel 내 값 클릭 시 메인 필터 반영(드릴 양방향) | P2 | ☐ |
| D-06 | `Usage.tsx` | 추론지표(§7.4) | ✓ LatencyPanel = TTFT/TPOT/E2E p50/p95/p99 + SLO | 유지 — 가장 완성도 높음. 다른 화면이 이걸 참조 | ✓ | — |
| D-07 | `Traffic.tsx` | 글로벌 시간범위(§3.4) | absent — 고정 600초/1h 윈도우 | G-05 컨텍스트 연결 + range 셀렉터 추가 | P1 | ☐ |
| D-08 | `Gpu.tsx` | 시간범위(§3.4) | absent — 현재상태 단일뷰 | range 셀렉터 + 시계열(슬라이드 패널엔 이미 스파크라인 O) | P2 | ☐ |
| D-09 | `Gpu.tsx` | KPI anatomy(§2.3) | ◐ StatCard×6 에 bar 만, spark/delta 없음 | 사용률/메모리/전력에 spark+delta 추가(추세 가시성) | P2 | ☐ |
| D-10 | `TimeseriesChart.tsx` | 드래그줌+테이블연동(§3.4) | ◐ 마우스 드래그줌·SLO점선 O. **키보드줌·테이블 필터연동 X** | `t+`/`t-` 키보드 줌 추가. **드래그 구간→하단 테이블 자동 필터** | P2 | ☐ |
| D-11 | `StatCard`·`Sparkline`·`BarList`·`StackedShareBar` | KPI·Top-N(§2.3·§2) | ✓ delta 색로직·Top-N+기타·세그먼트 클릭 다 구현 | 유지 — 재사용 기반 탄탄 | ✓ | — |

---

## 3. 관측성군 (Traces · Sessions · Diagnostics · Eval + waterfall 컴포넌트) ★최우선

| ID | 파일 | 패턴(§) | 현재 상태 | 할 일 (구체) | 우선 | 상태 |
|----|------|---------|-----------|--------------|------|------|
| O-01 | `Traces.tsx` | tree↔timeline 토글(§7.2) | **absent** — waterfall 고정 | **segmented 토글 추가**: 계층(tree) ↔ 시간순(timeline). Langfuse 2025.03 거동 | **P1** | ☐ |
| O-02 | `Traces.tsx` | span 검색(§7.2) | **absent** — decision/status/model/app 상위 필터만 | **타입/ID/이름 검색창** 추가(span 폭증 대비) | **P1** | ☐ |
| O-03 | `Traces.tsx` | waterfall span(§7.2) | ✓ span-wf 폭포 + TTFT 기준선 + SlidePanel→openSpan→SpanAttrs | 유지. tree 뷰(O-01)와 데이터 공유 | ✓ | — |
| O-04 | `Traces.tsx` | 추론지표·라우팅(§7.4) | ◐ TTFT/Decode 분해·tok/s 근사 O. **TPOT 명시·disagg/agg X** | TPOT 라벨 명시. route 필드를 disagg/agg 비교 뱃지로(**백엔드 선행**) | P3 | ☐ |
| O-05 | `Traces.tsx` | 추론 점진공개(§6.6) | absent — 모든 span 속성 동시 노출 | span 속성 collapsed reasoning 섹션(기본 접힘) | P2 | ☐ |
| O-06 | `Sessions.tsx` | 세션 리플레이(§7.2) | **absent** — 정적 타임라인 목록(`sess-timeline`)만 | **순차 재생(play/next) + 타임트래블 스크럽**. 턴 클릭→인라인 span(현재는 Traces 로 이탈) | **P1** | ☐ |
| O-07 | `Diagnostics.tsx` | 의존성 타일/벤토(§2·§8) | **absent** — 테이블만 | 9개 의존성을 **상태 벤토 타일**(정상/주의/실패 색)로. 연결 그래프 고려 | P2 | ☐ |
| O-08 | `Diagnostics.tsx` | 에러 구체+복구액션(§6.2) | ◐ error 메시지·fallback_note O. **단일 복구 액션 X** | 각 실패에 "구체 사유 + 복구 액션(재시도/설정 링크)" 1개 명시 | P1 | ☐ |
| O-09 | `EnginePipelinePanel.tsx` | waterfall/tree(§7.2) | ✓ waterfall↔tree 토글 + 단계 색분할 + % | 유지 — Traces(O-01)가 이 패턴 참조하면 됨 | ✓ | — |
| O-10 | `PipelineWaterfall.tsx` | tree 뷰 일관성(§7.2) | ◐ waterfall만(EnginePipelinePanel 과 불일치) | tree 토글 추가해 일관성 맞춤 | P3 | ☐ |
| O-11 | `EventHistogram.tsx` | 시간대 분포(§3) | ✓ 32버킷 스택 + 색분할 + 시간축 | 유지 | ✓ | — |
| O-12 | `Eval.tsx` | 신뢰도 평문큐(§6.4) | ◐ 점수(1-5)+색·rationale O. 신뢰구간 X | 점수에 평문 큐("높은 일치/근거 부족"). Traces 연동 고려 | P3 | ☐ |
| O-13 | `DetailModal.tsx` vs `SlidePanel.tsx` | 디테일 일관성(§3.3) | ✓ 관측성 전반 SlidePanel 우측 슬라이드 채택(DetailModal 사실상 미사용) | DetailModal 제거 검토(중복) | P3 | ☐ |

---

## 4. 관리/실행군 (Guard · Keys · Models · Endpoints · Credentials · ModelImport · Settings · Playground)

| ID | 파일 | 패턴(§) | 현재 상태 | 할 일 (구체) | 우선 | 상태 |
|----|------|---------|-----------|--------------|------|------|
| M-01 | `Playground.tsx` | AI 챗 6상태(§6.2) | **absent** — `busy` 불리언만(queued/thinking/streaming/error/stopped 없음) | **6 상태 머신 구현**. 비스트리밍→스트리밍 전환 | **P1** | ☐ |
| M-02 | `Playground.tsx` | stop 버튼·캐럿(§6.2·6.3) | **absent** — 취소 불가, "생성 중…" 정적 텍스트 | **stop 버튼 필수** + 스트리밍 캐럿 + DOM 30~60ms 배치 + 오토스크롤 100px 규칙 | **P1** | ☐ |
| M-03 | `Playground.tsx` | TTFT/first-token(§6.3·§7.4) | ◐ 지연/tok·s/토큰수 O. **TTFT 없음**(L174 "스트리밍 후 추가" 주석) | 스트리밍(M-01) 도입 시 **first-token=TTFT 실측 표기**(차별 축) | **P1** | ☐ |
| M-04 | `Playground.tsx` | 모델 셀렉터·인용·신뢰도(§6.1·6.4) | ◐ 모델 드롭다운 O. 인용·신뢰도수치 X(guard 태그만) | 응답에 모델명 라벨·신뢰도 평문큐. 메시지별 복사/regenerate | P2 | ☐ |
| M-05 | `Guard.tsx` | 구체사유+복구액션(§6.2) | ◐ decision/guard_types/jb_confidence 사유 O. **복구 액션 X**(증적 읽기전용) | 위반 항목에 복구 액션(예외 추가/재분류 링크) — manage 한정 | P2 | ☐ |
| M-06 | `Guard.tsx`·`GuardOverview.tsx` | 신뢰도 평문큐(§6.4) | ◐ jb_confidence % 만. PII 신뢰도 없음, 입/출력 분리 없음 | PII 신뢰도 추가 + 입력/출력 판정 분리 + 평문 큐 표기 | P2 | ☐ |
| M-07 | `Guard.tsx` | 위반 큐+드릴(§3.3) | ✓ EventHistogram + 테이블 + SlidePanel 드릴인 | 유지 | ✓ | — |
| M-08 | `Models.tsx`·`ModelImport.tsx` | 벤토 카드(§2) | ✓ model-grid 반응형 카드 + 카드내 메트릭(tok/s·TTFT·GPU) | 유지 — 카탈로그 모범 | ✓ | — |
| M-09 | `Keys/Models/Endpoints/Settings.tsx` | 마스터-디테일(§3.3) | ✓ 전부 SlidePanel 우측 슬라이드 | 유지 — 동선 일관 | ✓ | — |
| M-10 | `Credentials.tsx`·`ModelImport.tsx` | 역할 게이팅(§3.1) | **absent** — 권한 체크 없음(모든 사용자 편집/임포트) | `useCap().can()` 게이팅 추가(다른 페이지와 일관) | P1 | ☐ |
| M-11 | `Credentials.tsx` | 마스터-디테일(§3.3) | ◐ 카드내 inline edit(목록-상세 미분리) | 현 규모면 유지 가능. 항목 늘면 SlidePanel 전환 | P3 | ☐ |
| M-12 | 관리 페이지 전반 | 에러 구체화(§6.2) | ◐ 대부분 `(e as Error).message` 제네릭 노출 | 에러 클래스(rate limit/network/권한)+단일 복구 액션으로 분류 | P2 | ☐ |

---

## 5. 우선순위 요약 (P1 = 먼저)

**P1 — 핵심 가시성/관측성 (이번 사이클):**
- O-01 Traces tree↔timeline 토글 · O-02 span 검색 · O-06 Sessions 리플레이 · O-08 Diagnostics 복구액션
- M-01·M-02·M-03 Playground 스트리밍 6상태+stop+TTFT
- D-04 추론지표 KPI · D-07 Traffic 시간범위 · G-05 글로벌 시간범위 컨텍스트
- M-10 Credentials/ModelImport 역할 게이팅 · G-04 색상 정체성(전제 A) 확정

**P2 — 편의·일관성:** D-01 벤토 · D-03 인지부하 3개 · D-05/D-09/D-10 차트 · O-05/O-07 · M-04/M-05/M-06/M-12 · G-01

**P3 — 고도화/백엔드 의존:** O-04 disagg·agg · O-10·O-12·O-13 · G-02·G-03 · M-11

---

## 6. 진행 로그

### Round P5 — 구현 + 시각 QA (2026-06-28) · 프론트엔드 전용

> **방식**: Phase1 공유인프라(직접) → Phase2 페이지별 4-에이전트 병렬 구현 → Phase3 CDP 시각 QA 루프(mock 모드, 상호작용 트리거 검증). **tsc 클린 · 전 14화면 console error 0.**

**완료(☑) — P1/P2:**
| ID | 결과 | QA 검증 |
|----|------|---------|
| G-01 CommandPalette 닫기 | ☑ | ⌘K → ✕ 닫기 버튼 + 푸터(↑↓/↵/esc) |
| G-04 색상 토큰 | ✓유지 | 임계 3단색 우수 — 유지(전제 A: 실코드 스틸블루 기준) |
| G-05 전역 시간범위 | ☑ | `timeRange.tsx` Context + `<RangeSelect/>`, 관제↔사용량 기간 공유·localStorage 영속 |
| O-01 Traces tree↔timeline | ☑ | seg-toggle "타임라인/트리"(평면 데이터 정직 안내) |
| O-02 span 검색 | ☑ | "guard" 입력 → 스팬 2/8 필터 |
| O-05 점진공개 | ☑ | span attr disclose + 입출력 미리보기 |
| O-06 Sessions 리플레이 | ☑ | ◀▶▶\| + 스크럽 + 인덱스, ▶ 클릭 1.2s 간격 "1/6→3/6" 자동진행 |
| O-07 Diagnostics 타일 | ☑ | diag-tiles 벤토(정상/미구성 배지·required_by·latency) |
| O-08 복구 액션 | ☑ | 실패/미구성 타일에 사유 평문 + 재시도/설정 안내 |
| O-12 Eval 평문큐 | ☑ | "4.2/5 · 대체로 일치" 배지 |
| M-01 Playground 6상태 | ☑ | idle→queued(펄싱닷)→thinking→streaming(캐럿)→complete |
| M-02 stop+캐럿+오토스크롤 | ☑ | 전송↔중지 토글, 중지 시 "부분 보존+이어서/다시생성" |
| M-03 TTFT 실측 | ☑ | 완료 칩 "TTFT 371ms" 실측 표기 |
| M-04 모델라벨+신뢰도큐+복사 | ☑ | "Gemma 3 27B IT" 라벨 + guardCue + 복사 |
| M-05 Guard 복구액션 | ☑ | 증적상세 "정책에서 보기"·"예외추가/정책조정"(manage 한정) |
| M-06 신뢰도 평문큐 | ☑ | "PII 탐지: PHONE", "Jailbreak 신뢰도 8.0%" |
| M-10 Credentials/ModelImport 게이팅 | ☑ | `can("credentials")`·`can("models.write")` — observe 읽기전용 |
| D-01 Dashboard 벤토 | ☑ | 12컬럼 비대칭(hero span-6 + span-3×2), hero 여백 폴리시 적용 |
| D-03 인지부하 3카드 | ☑ | 기본 3카드 + "GPU/MIG 더 보기 ▼/접기 ▲" |
| D-07 Traffic 윈도우 | ☑ | 5/10/30분 윈도우 셀렉터 → fetchProxyStats |
| D-10 키보드 줌 | ☑ | svg 포커스 +/=/−/0/Esc, "줌 초기화" 등장 |

**🐞 발견·수정(QA loop)**: ① **Playground 응답 "대기 중" 고착** — `send`에서 `assistantIdx`를 setTurns 업데이터 부수효과로 잡아 React 비동기 실행 탓에 호출 시점 `-1` → 모든 turn 갱신 무시. turns 길이로 결정론적 계산하도록 수정 → 스트리밍 정상. ② **Dashboard hero `row-2` 여백** — GPU 접힘(기본) 시 hero 하단 공백 → row-2 제거, span-6 단일행으로 정리.

**정직 보류**: D-09 Gpu spark/delta(요약 카드는 순간 스칼라값, 시계열 배열 없음 — 억지 생성 안 함) · O-04 disagg/agg·O-10 PipelineWaterfall tree·O-13 DetailModal 제거 = **P3(백엔드/후속)**.

**QA 스코어카드(평균 ≈ 9.2)**: Traces 9.5 · Sessions 9.5 · Playground 9.5 · Guard 9.5 · Dashboard 9.5 · Usage 9 · Diagnostics 9 · Eval 9 · Traffic 9 · Credentials/ModelImport 9 · CommandPalette 9 · Gpu 8.5(무변경·무회귀). **목표 9.0 초과 달성.**

### Round P6 — 브랜드 테마 + P3 (2026-06-28)

**신규 기능 — 브랜드 색상 테마** (전제 A 해소): `web/src/theme.tsx`(ThemeProvider + `useBrand` + `applyBrand` + `deriveBrand`). **설정 화면 "외관 · 브랜드 색상" 카드** — 프리셋 5종(스틸블루 기본/오렌지/틸/인디고/슬레이트) + 커스텀 HEX(strong/weak/lite 자동 파생) + 미리보기. `--primary` 계열 4변수를 documentElement 인라인 오버라이드(라이트·다크 공통)·localStorage 영속. **QA**: 오렌지 클릭 → 전 UI(상단바·네비·KPI·차트·버튼) 즉시 전환 + 화면 이동 후 유지 + 스틸 복귀 검증. **기본은 스틸블루 유지**, 고객사 표준색은 설정에서 전환.

**P3 완료(☑):**
| ID | 결과 | QA |
|----|------|-----|
| O-10 PipelineWaterfall 트리 | ☑ | 워터폴↔트리 토글, 계층 들여쓰기(가드레일 3%→귀속 1%→엔진 96%) |
| O-13 DetailModal 제거 | ☑ | 미사용 컴포넌트 삭제(전 화면 SlidePanel 통일), tsc 클린 |

**P3 정직 보류(백엔드/데이터 필요):** O-04 disagg/agg(mock route="local-vllm" — agg/disagg 패턴 데이터 없음) · D-09 GPU spark(시계열 배열 없음) · D-05 Usage 필터 역연동(그룹축 구조상 모호·저가치) · G-02 가상화(현 규모 불필요) · G-03 자연어 질의(백엔드 선행).

| 날짜 | ID | 변경 | 커밋 |
|------|-----|------|------|
| 2026-06-28 | G-01/05·O-01/02/05/06/07/08/12·M-01~06/10·D-01/03/07/10 | Round P5 구현+QA(평균 9.2) | (미커밋) |
| 2026-06-28 | 테마(theme.tsx)·O-10·O-13 | Round P6 브랜드 색상 설정 + P3 | (미커밋) |
| 2026-06-28 | Dashboard·UsageTrendChart·index.css | Round P7 반응형 레이아웃 수정 | (미커밋) |

### Round P7 — 반응형 레이아웃 버그 수정 (2026-06-28)
> **사용자 제보**: 특정 폭(12컬럼 구간/줌)에서 ① 대시보드 hero 카드 하단 빈 공간 ② 사용량 추세 토글이 차트 제목과 겹침.
> **원인·수정**:
> - **대시보드 KPI**: 비대칭 bento hero(span-6)가 우측 span-3 카드(세로 적층, 더 김)보다 짧아 grid `align-items:stretch` 로 **stretch되며 하단 여백** 발생 → **동일 높이 `kpi-grid`(auto-fit minmax 230px)** 로 변경. 폭 따라 3~4열 자연 줄바꿈, 높이 어긋남 없음. (대시보드 KPI 표준)
> - **사용량 추세 토글**: `.trend-metric-toggle` 가 `position:absolute` 로 차트 카드 제목("추세 ▲증가") 위에 겹침 → `UsageTrendChart` 에 `headerRight` prop 추가해 **카드 헤더 flex 흐름**(flex-wrap)에 배치. 절대 포지셔닝 제거.
> - **테이블 robust**: `.card:has(.usage-table){overflow-x:auto}` — 밀도 높은 표(키·앱 등)가 좁은 폭에서 카드 안 가로 스크롤(컬럼 잘림·페이지 가로 스크롤 방지).
> **QA**: 전 페이지 1000/1180/1440px 스윕. 대시보드·사용량 양쪽 폭 정상, 키 테이블 카드 내 스크롤, 나머지(guard/gpu/traffic/traces/sessions/models/endpoints/playground/diagnostics/settings) 이상 없음. tsc 클린.
