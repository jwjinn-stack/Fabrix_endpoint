# Agent · 바이브 코딩 시대의 UI/UX 트렌드 (2026) — 구체 스펙 & 실사례

> **목적**: FABRIX Endpoint 의 React 화면(Dashboard, Endpoints, Traces, Sessions, Diagnostics, Guard, Usage, Keys, Models, Settings 등)을 개선할 때 **그대로 코드에 옮길 수 있는** 레이아웃 스펙·컴포넌트 패턴·인터랙션 규칙을 모은다. 트렌드 요약이 아니라 *숫자·코드·실제 제품 거동*까지 내려간다.
> **연결**: [상용SW-화면UIUX-리서치.md](../상용SW-화면UIUX-리서치.md)(화면별 레이아웃) · [경쟁솔루션-벤치마킹.md](../경쟁솔루션-벤치마킹.md)(기능 갭) · [레이턴시-관측-소프트웨어-리서치.md](../레이턴시-관측-소프트웨어-리서치.md) · UI 톤: 라이트+오렌지(Backend.AI), 다크/네온 금지
> **버전**: `v1.0.0` · 작성 2026-06-28 (Asia/Seoul) · 방식: WebSearch + 공식 docs/GitHub/디자인 가이드 WebFetch 실제 리서치
> **확신도 범례**: 높음(공식 docs·코드·제품 changelog 직접 확인) · 중간(2차 자료·다수 일관 출처) · 불확실("추측" 명시)
> ⚠ **한계**: 일부 제품은 로그인 SPA 라 픽셀·정확 색상값은 미확정. 외부 제안서에 특정 수치 인용 시 공식 원본 대조 필수.

---

## 0. TL;DR — 즉시 적용 체크리스트 9

리서치 전반에서 **반복 검증된** 패턴. 우리 화면 전반에 일관 적용.

1. **벤토 그리드 레이아웃**: 12컬럼 CSS Grid, 비대칭 타일(hero 6col / KPI 3col×4 / 차트 8col). 타일 클수록 중요. gap 16~24px. (Apple·Vercel·Datadog·Linear 공통) — §2
2. **KPI 카드 = 현재값 + 임계 색 + 전기간 대비 변화율 화살표 + 미니 스파크라인** 한 셀. 기본 뷰에 **3개만**, 나머지는 "더 보기". (인지부하 검증 디자인) — §2·§3
3. **프로그레시브 디스클로저 — 2차 화면 1단계까지만**. 목록 행 클릭 → 우측 슬라이드 디테일 패널(페이지 이동 없음). — §3
4. **시간범위 전 위젯 동기화 + 드래그-투-줌 + 키보드 줌**(`t+`/`t-`). 차트 구간 드래그 → 하단 테이블 자동 필터. (Grafana 2026.01 거동) — §3
5. **⌘K 커맨드 팔레트**: `cmdk`(Vercel) 사용, 즉시 타이핑·↑↓·Enter·Esc·마우스용 닫기 버튼. Linear/Vercel/GitHub 표준. — §4
6. **생성형 UI 는 Static(AG-UI) 패턴부터**: 프런트가 컴포넌트 소유, 에이전트는 "언제·어떤 데이터" 만. `useFrontendTool` 의 `status` 로 loading/complete 렌더 분기. — §5
7. **AI 챗/Agent UX 6 상태**: queued→thinking(접힘)→streaming(캐럿, 30~60ms 배치, first-token <800ms)→complete→error(구체 사유)→stopped(부분출력 보존+Continue). **stop 버튼 필수.** — §6
8. **신뢰 3종 세트**: 번호 인라인 인용→확장 소스카드, 평문 신뢰도 큐("높은 일치/근거 부족"), thumbs up/down. — §6
9. **관측성은 tree↔timeline 토글 + 세션 리플레이 + waterfall span**. (Langfuse 2025.03 신규 trace view 거동) — §7

> **FABRIX 고유 차별 축** (트렌드에 얹을 것): TTFT/TPOT/tok-per-sec 를 KPI·플레이그라운드·트레이스 스팬에 1급 시민으로 · Dynamo disagg vs agg 라우팅 비교 · 할당 vs 실사용 갭 게이지 · **OTel→자체 React 화면**(외부 SaaS 불필요, 폐쇄망 적합).

---

## 1. 바이브 코딩 / UI 생성 도구 — 워크플로우 (시장 현황)

생성형 UI 도구가 메인스트림 진입. **Lovable 800만 사용자·$200M ARR, Bolt 5개월 만에 $40M ARR.** (확신도: 중간 — 2차 자료)

**2026 베스트 프랙티스 = 하나 고르기가 아니라 단계별 조합:**

| 단계 | 도구 | 역할 | FABRIX 적용 |
|------|------|------|-------------|
| 탐색·발산 | Google Stitch | 디자인 아이디어 시각 탐색 | 신규 화면 레이아웃 초안 |
| **컴포넌트 생성** | **v0 (Vercel)** | Next.js/React 개별 컴포넌트(기존 코드에 drop-in) | **★ 가장 적합** — 기존 React 코드베이스에 컴포넌트 단위 주입 |
| 풀스택 프로토타입 | Lovable / Bolt | 프롬프트→앱+호스팅 | 빠른 PoC, 화면 발상 |
| 코드 가능 시 | Claude Code | "코드 짤 줄 알면 1픽"(8개 도구 테스트 결과) | 실제 통합 개발 |

→ FABRIX 는 이미 React+Go 코드베이스가 있으므로 **v0 패턴**(컴포넌트 단위)이 정답. 신규 화면(Traces/Sessions/Diagnostics)을 v0 로 초안 → Backend.AI 라이트+오렌지로 정제 → 기존 컴포넌트(`Skeleton`, `Layout`)와 통합.

*출처*: [roadmap.sh 베스트 도구](https://roadmap.sh/vibe-coding/best-tools) · [NxCode Stitch vs v0 vs Lovable vs Bolt](https://www.nxcode.io/resources/news/vibe-design-tools-compared-stitch-v0-lovable-2026) · [Justin McKelvey 8개 테스트](https://justinmckelvey.com/blog/best-vibe-coding-tools-2026)

---

## 2. 대시보드 레이아웃 — 벤토 그리드 구체 스펙 ★

**벤토 그리드** = 도시락처럼 크기가 다른 직사각형 타일의 모듈러 레이아웃. 각 타일 = KPI/차트/상태 1종. **비대칭 타일 크기로 시각 위계를 만든다 — 타일이 클수록 중요, 레이아웃 자체가 "어디를 먼저 볼지" 말해준다.** (확신도: 높음 — 디자인 가이드 + 실제 제품 확인)

### 2.1 CSS Grid 구체 스펙

```css
/* 데스크톱(1024px+): 12컬럼(또는 4~6) 기반 */
.bento-dashboard {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 16px;            /* 16~24px 일관 유지 */
}
.tile-hero    { grid-column: span 6; grid-row: span 2; } /* 주력 차트/지표 */
.tile-chart   { grid-column: span 8; }                   /* 주 시계열 */
.tile-kpi     { grid-column: span 3; }                   /* KPI 4개 = 3×4 */
.tile-status  { grid-column: span 2; }                   /* 상태 인디케이터 */
```

Tailwind 사용 시: `col-span-2`, `row-span-2` + 반응형 프리픽스(`md:`, `lg:`).

### 2.2 반응형 브레이크포인트 (3단)

| 구간 | 컬럼 | 거동 |
|------|------|------|
| 데스크톱 ≥1024px | 4~6(또는 12) | 풀 레이아웃 |
| 태블릿 768~1023px | 2~3 | span 축소 |
| 모바일 <768px | 1~2 | 선형 스택(linear stacking) |

### 2.3 KPI 카드 한 셀 구성 (검증된 anatomy)

```
┌─────────────────────────────┐
│ 라벨(p99 레이턴시)          │  ← 무채색 라벨
│ 1,240 ms       ▲ +12%       │  ← 현재값(큰 숫자) + 변화율 화살표(색)
│ ▁▂▃▅▇▆▄  [스파크라인]       │  ← 미니 추세
└─────────────────────────────┘  정상=무채색 / 주의·위험만 오렌지·적색
```

### 2.4 실제 제품 사례 (확신도: 높음~중간)

- **Datadog**: 대시보드 빌더 = SaaS 최고 성숙도 벤토 구현. **12컬럼 CSS Grid 에서 타일 리사이즈**, time-series~service map 등 **20+ 위젯 타입**.
- **Vercel**: 대시보드에 벤토 패턴 사용. **2026-02-26 대시보드 리디자인 전면 롤아웃**(피드백 반영).
- **Linear**: 프로젝트 상태 화면에 near-bento — 활성 스프린트는 큰 타일, 개별 이슈 카운트는 작은 메트릭 카드.
- **Google Analytics/Vercel/Linear 공통 대시보드 레시피**: KPI row(작은 타일 4개) → 주 차트(3~4컬럼 타일) → 보조 위젯(2컬럼) → gap 16~24px.

### 2.5 FABRIX 적용

- `Dashboard.tsx`: 12컬럼 벤토. **좌상단 hero 타일에 가장 critical 한 지표**(시선 먼저 닿는 곳) — 예: 활성 엔드포인트 / 전체 에러율 / GPU 가동률. 우측 2×2 에 상태 인디케이터.
- KPI 카드는 위 anatomy 그대로: 추론 지표(TTFT/TPOT/tok·s)를 KPI 카드 1급 시민으로.
- 기본 뷰 KPI **3개 우선**, 나머지 "더 보기" (§3 인지부하).

*출처*: [studiomeyer 벤토 그리드+코드](https://studiomeyer.io/en/blog/bento-grid-layouts) · [orbix.studio 벤토 가이드 2026](https://www.orbix.studio/blogs/bento-grid-dashboard-design-aesthetics) · [SaaSFrame 벤토 실전](https://www.saasframe.io/blog/designing-bento-grids-that-actually-work-a-2026-practical-guide) · [Vercel 대시보드 리디자인 롤아웃](https://vercel.com/changelog/dashboard-navigation-redesign-rollout)

---

## 3. 가시성의 핵심 — 인지부하·프로그레시브 디스클로저·시간범위 ★

### 3.1 구조적 전환 (2026 대시보드)

정적 리포팅 → **AI 주도 시스템**. 3대 변화 (확신도: 중간):
1. **AI 생성 인사이트가 수동 차트 설정을 대체** — 사용자가 차트를 짜는 대신 시스템이 "지금 볼 것"을 선제 표면화
2. **대화형 인터페이스가 메뉴 탐색 대체** (§7.3)
3. **역할 기반 컨텍스트 적응 레이아웃** — 임원/운영자/분석가가 같은 화면을 안 봄

### 3.2 인지부하 기준 설계 (검증된 규칙)

> 화면의 모든 요소는 **현재 의사결정을 돕거나, 아니면 제거.** 사용자 테스트를 통과한 디자인은 **기본 뷰에 메트릭 3개**만 노출하고 나머지는 의도적 "더 보기" 인터랙션 요구.

- 가장 중요한 high-level 지표 → **좌상단/주 포커스**(시선 착지점).
- 2026 엔 "비어있음"보다 **"명료함"** — 극단 단순화보다 가시적 옵션 + 명확 가이드.

### 3.3 프로그레시브 디스클로저 (가장 강력한 가시성 패턴)

> 요약 뷰에 핵심만 → 클릭/확장/드릴다운으로 상세. **2차 화면 1단계로 충분** — 다단계 중첩은 기능을 "묻어버려" 혼란. 단순할수록 좋음.

**역할별 기본 뷰 분기(실전 예):**
- 임원 = 한눈에 트렌드
- 운영자 = 자기 큐 + 응답시간 + 에스컬레이션 상태
- 분석가 = 필터 가능한 granular 테이블(드릴인)

**마스터-디테일 동선**: 목록 행 클릭 → **우측 슬라이드 상세 패널**(페이지 이동 없음). Datadog·Splunk·Langfuse 공통.

### 3.4 시간범위 인터랙션 — Grafana 2026.01 구체 거동 (확신도: 높음)

| 인터랙션 | 동작 |
|----------|------|
| 드래그-투-줌 | 시각화 영역에서 시작~끝 시간 드래그 후 놓으면 줌인 |
| 줌아웃 | 시각화 영역 더블클릭 → 양옆 절반씩 확대(2배 기간) |
| x축 팬 | x축 타임스탬프를 좌우 드래그 → 놓으면 대시보드 시간범위 갱신 |
| 키보드 줌 | `t+` = 현재 범위 절반으로 줌인, `t-` = 2배로 줌아웃 |
| 동기화 | **시간범위가 전 위젯 동기화** + 대시보드 레벨로 한 구간씩 앞뒤 점프 |

### 3.5 FABRIX 적용

- 전 대시보드 화면 상단 = **글로벌 시간범위 셀렉터**(전 위젯 동기화). 차트 드래그-투-줌 → 하단 테이블 자동 필터.
- `Dashboard`/`Usage`/`Traffic`: 기본 KPI 3개 + "더 보기". 행 클릭 → 우측 슬라이드 디테일 패널.
- `Guard`(가드레일): 운영자 기본 뷰 = 위반 큐 + 심각도; 분석가용 필터 테이블은 드릴인.

*출처*: [think.design 대시보드 2026 Do's/Don'ts](https://think.design/blog/dashboard-design-in-2026-dos-and-donts/) · [DesignRush 9 원칙](https://www.designrush.com/agency/ui-ux-design/dashboard/trends/dashboard-design-principles) · [UXPilot 12 원칙](https://uxpilot.ai/blogs/dashboard-design-principles) · [IxDF 프로그레시브 디스클로저(2026)](https://ixdf.org/literature/topics/progressive-disclosure) · [Grafana 시간범위 팬·줌 2026.01](https://grafana.com/whats-new/2026-01-15-time-range-pan-and-zoom/) · [Fuselab 엔터프라이즈 UX 2026](https://fuselabcreative.com/enterprise-ux-design-guide-2026-best-practices/)

---

## 4. ⌘K 커맨드 팔레트 — 구체 구현 ★ (FABRIX `CommandPalette.tsx` 이미 존재)

⌘K 팔레트는 고품질 SW의 **사실상 표준** — Linear·Vercel·GitHub·Slack·Raycast 전부 채택. 메뉴 탐색→대화형 전환의 진입점. (확신도: 높음)

### 4.1 라이브러리: `cmdk` (Vercel)

React 사실상 표준. Linear·Vercel·Raycast·Sourcegraph 사용. **로직+접근성은 제공, 스타일·레이아웃은 완전 자유** → 우리 Backend.AI 톤 적용 가능. Floating UI / Zustand / TanStack Query / TanStack Virtual 와 연동(대량 항목 가상화).

### 4.2 필수 키보드 거동 (체크리스트)

- ⌘/Ctrl+K 로 오픈
- 오픈 즉시 타이핑 가능
- ↑↓ 화살표 네비게이션
- Enter 선택, Esc 닫기
- **마우스 사용자용 명시적 닫기 버튼**(키보드 only 금지)

### 4.3 FABRIX 적용

기존 `web/src/components/CommandPalette.tsx` 를 `cmdk` 기반으로 정비. 액션 카테고리:
- **이동**: 화면 점프(Dashboard/Traces/Guard…)
- **조회**: "엔드포인트 X 트레이스", "키 발급 내역"
- **(manage 프로파일) 실행**: 정책 토글·키 발급 등 mutating 액션 — observe(읽기전용)에선 숨김(`/capabilities` 연동)
- **(확장) 자연어 질의**: §7.3 대화형 분석 진입점

*출처*: [techinterview Cmd+K like Linear/Vercel](https://www.techinterview.org/post/3233475212/build-command-palette-cmd-k/) · [cmdk in React 셋업](https://www.lmctogetherwebuild.com/cmdk-in-react-build-a-fast-command-palette-setup-examples/) · [UX Patterns 커맨드 팔레트](https://uxpatterns.dev/patterns/advanced/command-palette) · [TextExpander 베스트 팔레트 2026](https://textexpander.com/blog/best-command-palette-tools)

---

## 5. 생성형 UI (Generative UI) — 코드 패턴 ★

**정의**: UI 일부를 AI 에이전트가 런타임에 생성/선택/제어. 디자이너가 모든 화면을 하드코딩하는 대신, 에이전트가 목표(자연어)로부터 대시보드·차트·필터·컨트롤을 on-demand 조립. (확신도: 높음 — CopilotKit/AG-UI 공식)

### 5.1 3가지 접근 (난이도·안전성순)

| 패턴 | 방식 | 안전성 | FABRIX |
|------|------|--------|--------|
| **Static (AG-UI)** | 프런트가 컴포넌트 소유, 에이전트는 "언제 보여줄지+데이터"만 | 높음 ✅ | **★ 권장** |
| Declarative (A2UI/Open-JSON-UI) | 에이전트가 JSON 스펙(카드/리스트/폼) 반환→프런트가 일관 스타일로 렌더 | 중간 | 차후 |
| Open-ended (MCP Apps) | 에이전트가 외부 UI 통째 임베드 | 낮음(유연·위험) | 비권장 |

> AG-UI 는 **UI 생김새를 정의하지 않는다** — 에이전트↔프런트 메시지 교환(런타임)만 정의하는 양방향 프로토콜. A2UI/MCP Apps 같은 UI 스펙을 같은 런타임 위로 실어 나름.

### 5.2 Static — `useFrontendTool` 실제 코드 (CopilotKit)

```javascript
useFrontendTool({
  name: "get_weather",
  description: "Get current weather information for a location",
  parameters: z.object({ location: z.string().describe("The city or location") }),
  handler: async ({ location }) => { /* ... */ return getMockWeather(location); },
  render: ({ status, args, result }) => {
    if (status === "inProgress" || status === "executing")
      return <WeatherLoadingState location={args?.location} />;   // 로딩 상태
    if (status === "complete" && result)
      return <WeatherCard {...JSON.parse(result)} />;             // 완료 렌더
    return <></>;
  },
});
```

**툴 라이프사이클 상태**: `inProgress`/`executing`(로딩) → `complete`(결과). → 프런트가 컴포넌트를 소유하므로 우리 디자인 시스템·접근성 그대로 유지.

### 5.3 Declarative — A2UI JSON 스펙 구조 (참고)

JSONL, 3종 envelope: `beginRendering`(테마/스타일 초기화) → `surfaceUpdate`(컴포넌트 정의/레이아웃: `Column`/`Text`/`TextField`/`Button` 등) → `dataModelUpdate`(폼/상태 바인딩). 에이전트가 레이아웃을 *제안*하되 렌더 엔진은 프런트가 통제 → 유연+안전 균형.

### 5.4 가시성 개선 효과 (왜 쓰나)

전통 챗은 "도구 실행·진행 상황이 채팅 메시지 뒤에 숨음". 생성형 UI 는 ▲구조화된 입력 수집(막연한 텍스트 대신 폼) ▲실시간 진행 시각화(중간 결과를 인터랙티브 컴포넌트로) ▲컨텍스트 따라 진화하는 적응형 인터페이스 ▲상황별 렌더(폼/테이블/카드를 필요할 때).

### 5.5 FABRIX 적용

- **Static(AG-UI) 부터.** 안전·기존 컴포넌트 재사용. **observe(삼성증권 읽기전용) 프로파일에 특히 적합** — 에이전트는 "어떤 차트를 보여줄지"만 결정, 실행/변경은 불가.
- 예: ⌘K 또는 챗에 "엔드포인트 A 의 어제 레이턴시 추세" → 에이전트가 우리 사전제작 `LatencyChart` 컴포넌트 선택 + 데이터 주입.
- 레퍼런스 구현: AG-UI Dojo(예제 각 50~200줄), `github.com/CopilotKit/generative-ui-playground`.

*출처*: [CopilotKit 생성형UI 개발자 가이드 2026](https://www.copilotkit.ai/blog/the-developer-s-guide-to-generative-ui-in-2026) · [ag-ui-protocol/ag-ui GitHub](https://github.com/ag-ui-protocol/ag-ui) · [CopilotKit/generative-ui GitHub](https://github.com/CopilotKit/generative-ui) · [Google A2UI 발표](https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/) · [OpenDataScience 생성형UI](https://opendatascience.com/generative-ui-when-the-agent-builds-the-interface-for-you/)

---

## 6. Agent UX / AI 챗 인터페이스 — 해부 & 상태 머신 ★

Gartner: **2026 말까지 엔터프라이즈 앱 40%가 task-specific AI 에이전트 통합**(2025 5% 미만→급증). 전통 UI 에 없던 새 요건: **투명성·상태 커뮤니케이션·오버라이드 컨트롤·에러 복구.** (확신도: 높음)

### 6.1 챗/Agent 인터페이스 9개 레이아웃 존 (확신도: 높음)

1. **대화 리스트**(좌측 레일) — 자동 생성 제목·타임스탬프·태그
2. **헤더** — 모델 셀렉터·편집가능 제목·공유·세팅
3. **메시지 스트림** — 세로 스크롤, **max-width 720~768px**(가독성)
4. **유저 메시지** — 우측 정렬, 편집 가능, 편집점에서 대화 포크
5. **어시스턴트 메시지** — 리치 Markdown(코드블록·테이블·수식)
6. **입력 컴포저** — 멀티라인, 첨부·모델픽커·전송, 내용 따라 성장
7. **Stop/Regenerate** — 스트리밍 중 "Stop generating" → 완료 후 "Regenerate"
8. **메시지별 액션** — 복사·편집·like·dislike·공유 (데스크톱 hover / 모바일 상시)
9. **후속 제안 칩** — 답변 아래 dismiss 가능 프롬프트 칩

### 6.2 메시지 6 상태 머신 (그대로 구현)

| 상태 | UI |
|------|-----|
| **Queued** | 펄싱 닷 / 시머 플레이스홀더 (200ms~2s) |
| **Thinking/Reasoning** | 모델이 뭘 하는지 **접힌(collapsed) 섹션**, "Thinking"/"Searching the web" 정직 라벨 |
| **Streaming** | 토큰 렌더 + 깜빡 캐럿, **DOM 업데이트 30~60ms 배치**, reflow 잔떨림 없이 |
| **Complete** | 전체 답변 + 메시지 액션 + 타임스탬프 |
| **Error** | **구체 에러 클래스**(rate limit/content filter/network) + 단일 복구 액션, 절대 "Something went wrong" 금지 |
| **Stopped** | 부분 출력 보존 + "Continue"/"Regenerate" |

### 6.3 스트리밍 구체 스펙

- **first-token latency 목표 <800ms** (Cursor 는 느린 페이지 로드보다 빨리 첫 토큰 시작 지향)
- 캐럿: 얇은 바 / 채운 사각 / 펄싱 닷
- Markdown **증분 파싱**: 닫는 펜스 전까진 plain text, 코드블록 하이라이트는 완료 후
- **오토스크롤 규칙**: 유저가 위로 스크롤하면 잠금 + "Jump to latest" 버튼, 하단 100px 이내일 때만 재개
- 코드블록: 원클릭 복사 + 일시 체크마크

### 6.4 신뢰 3종 세트 (확신도: 높음)

- **인용**: 번호 인라인 각주(윗첨자) → 클릭 시 확장 소스카드(제목·URL·발췌). 사이드바 또는 답변 하단.
- **신뢰도**: 점수보다 **평문 큐가 더 유용** — "기준과 높은 일치" vs "문서 구간에서 근거 부족". + 추론 단계 점진 공개.
- **피드백**: thumbs up/down. + 모든 어시스턴트 메시지에 작은 **모델명 라벨**.

### 6.5 접근성·안티패턴

- `aria-live="polite"`, WCAG 2.2 AA(본문 4.5:1), `prefers-reduced-motion`, 전송 후 포커스 컴포저 유지
- **안티패턴**: 빠른 모델을 throttle 하는 가짜 타이핑 애니, 제네릭 에러 토스트, **stop 버튼 누락**, 유저 스크롤과 싸우는 오토스크롤, 묻힌 모델 셀렉터, 복사버튼 없는 코드블록

### 6.6 Agentic 고급 패턴

- **Explainable AI**: 의사결정 시각화·출처 귀속·신뢰도 지표·추론 점진 공개
- **실시간 에이전트 감독**: 개입(intervention) 컨트롤·예외 기반 알림·성능 모니터링
- **선제적이되 비침투적**: "마감 내일입니다 — 대기 작업 요약하고 팀에 알릴까요?"(제안하되 강요 안 함)
- **멀티모달**: 챗/음성/화면/자동 워크플로 매끄러운 전환

### 6.7 FABRIX 적용

- (있다면)플레이그라운드/챗 화면: 위 6 상태 머신 + 스트리밍 스펙 그대로. **TTFT 를 first-token 으로 실제 측정·표기**(우리 차별 축).
- `Traces`/`Sessions`: 6.6 의 추론 점진 공개·출처 귀속을 trace 스팬 디테일에 반영.
- `Guard`(가드레일): 위반을 "구체 사유 + 단일 복구 액션"(6.2 error 패턴)으로. 신뢰도 평문 큐로 SR(Safety Rule) 판정 표기.

*출처*: [setproduct AI 챗 인터페이스 해부](https://www.setproduct.com/blog/ai-chat-interface-ui-design) · [TheFrontKit AI 챗 UI 베스트 2026](https://thefrontkit.com/blogs/ai-chat-ui-best-practices) · [UX Patterns AI 챗](https://uxpatterns.dev/patterns/ai-intelligence/ai-chat) · [Fuselab Agent UX 2026](https://fuselabcreative.com/ui-design-for-ai-agents/) · [ProCreator Agentic 디자인 패턴 2026](https://medium.com/@pro.namratapanchal/what-are-the-must-know-agentive-design-patterns-for-2026-21cf34839a01) · [agentic-design.ai UI/UX 패턴](https://agentic-design.ai/patterns/ui-ux-patterns)

---

## 7. 관측성 대시보드 — FABRIX/Langfuse 직결 ★

FABRIX 가 Langfuse 통합 중이라 가장 밀접. (관련: [research/langfuse-가드레일-전략-리서치.md](../research/langfuse-가드레일-전략-리서치.md), [../langfuse-trace-정합-설계.md](../langfuse-trace-정합-설계.md))

### 7.1 트렌드: "관측"→"품질 평가"

단순 트레이싱을 넘어 AI 동작 *관측*과 품질 *평가* 갭을 메우는 도구가 2026 승자. APM류(Datadog/New Relic)가 "AI 탭" 추가 vs. **AI-네이티브(Langfuse·LangSmith·Helicone·Arize Phoenix)**. 평가 기준 = **트레이스 깊이·에이전트 전용 UX·리플레이/디버깅·OTel 지원·셀프호스팅·가격모델.** (확신도: 중간)

> 단일 LLM 콜용 도구는 "10분 실행·15개 도구 호출·스스로 제어흐름 결정" 에이전트엔 무너짐 → 에이전트 전용 UX 필수.

### 7.2 Langfuse Trace View 구체 거동 (2025.03 신규, 확신도: 높음)

- **tree ↔ timeline 토글**: 계층(hierarchical) ↔ 시간순(chronological) 전환
- **waterfall/timeline**: 레이턴시 이슈를 timeline 뷰로 디버그 (span 폭포)
- **데이터 모델 3계층**: observations(generations/toolcalls/RAG retrieval 등, **중첩 가능**) ⊂ traces ⊂ **sessions**
- **세션 리플레이**: 여러 trace 를 session 으로 묶어 **전체 인터랙션 순차 재생** (타임트래블 — 추론 경로가 목표에서 어디서 갈라졌는지)
- 뷰 설정: 점수·코멘트·메트릭 show/hide + 컬러코딩, 타입/ID/이름으로 검색

### 7.3 대화형 분석(자연어→데이터) 실제 제품 (확신도: 중간)

- **Snowflake Cortex Analyst**: plain-English 질문→직접 답(SQL 안 씀). well-modeled 데이터에서 **NL→SQL 95% 정확도**. 전용 추론모델 Arctic-Text2SQL-R1.5.
- **ThoughtSpot Spotter**: 검색바 분석 originator. 대화형·후속질문·자동 인사이트, **단일 프롬프트로 대시보드 통째 생성**.

### 7.4 FABRIX 적용 (가장 직접적)

- 신규 `Traces.tsx` / `Sessions.tsx` 를 **Langfuse trace view 거동에 정렬**: tree↔timeline 토글 + waterfall span + 세션 리플레이 + 타입/ID 검색.
- **OTel→자체 React 화면**(외부 SaaS 불필요) = 폐쇄망 증권사 차별 (외부 SaaS 못 쓰는 환경).
- span 디테일에 추론지표(TTFT/TPOT) 1급 노출 + Dynamo disagg vs agg 라우팅 비교.
- (확장) ⌘K/챗에 §7.3 대화형 분석 — Static 생성형 UI(§5)로 안전하게.

*출처*: [Langfuse Sessions docs](https://langfuse.com/docs/observability/features/sessions) · [Langfuse 신규 Trace View 2025.03](https://langfuse.com/changelog/2025-03-19-new-trace-view) · [Langfuse Tracing docs](https://langfuse.com/docs/tracing) · [AIMultiple 15 관측 도구 2026](https://aimultiple.com/agentic-monitoring) · [Laminar Top 6 에이전트 관측 2026](https://laminar.sh/article/2026-04-23-top-6-agent-observability-platforms) · [Confident AI 베스트 관측 2026](https://www.confident-ai.com/knowledge-base/compare/best-ai-observability-tools-2026) · [Snowflake Cortex Analyst docs](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst) · [getdot 대화형 분석 2026](https://www.getdot.ai/blog/conversational-analytics-software)

---

## 8. FABRIX 화면별 적용 매핑 (실행표)

| 화면 (파일) | 적용 패턴 | 구체 액션 |
|-------------|-----------|-----------|
| **Dashboard** (`Dashboard.tsx`) | 벤토(§2)·인지부하 3개(§3.2)·시간범위 동기화(§3.4) | 12컬럼 그리드, 좌상단 hero=최critical 지표, KPI 3개+더보기, 글로벌 시간범위 |
| **Traces** (`Traces.tsx`, 신규) | Langfuse trace view(§7.2)·Agent 추론공개(§6.6) | tree↔timeline 토글, waterfall span, 검색, TTFT/TPOT 노출 |
| **Sessions** (`Sessions.tsx`, 신규) | 세션 리플레이(§7.2) | trace 묶음 순차 재생, 타임트래블 |
| **Diagnostics** (`Diagnostics.tsx`, 신규) | 상태 인디케이터 타일(§2)·에러 구체화(§6.2) | 9개 의존성 상태 벤토 타일, 구체 에러+복구 액션 |
| **Guard** (`Guard.tsx`) | 마스터-디테일(§3.3)·신뢰도 평문큐(§6.4)·에러패턴(§6.2) | 위반 큐→우측 디테일 패널, SR 판정 평문 큐 |
| **Usage/Traffic** (`Usage.tsx`,`Traffic.tsx`) | 드래그줌(§3.4)·Top-N·프로그레시브(§3.3) | 차트 드래그→테이블 필터, 행클릭→슬라이드 패널 |
| **Keys/Models/Endpoints** | 마스터-디테일(§3.3)·KPI카드(§2.3) | 목록→우측 디테일, 모델 카드에 추론지표 |
| **CommandPalette** (`CommandPalette.tsx`) | cmdk(§4)·생성형UI 진입(§5) | ⌘K, 이동/조회/(manage)실행, capabilities 게이팅 |
| **전역** (`Layout.tsx`,`capabilities.tsx`) | 역할 적응 레이아웃(§3.1)·Static 생성형UI(§5.5) | observe=읽기전용 뷰, manage=풀, `/capabilities` 연동 |

---

## 부록 A. 전체 출처

**바이브코딩 도구**: [roadmap.sh](https://roadmap.sh/vibe-coding/best-tools) · [NxCode 비교](https://www.nxcode.io/resources/news/vibe-design-tools-compared-stitch-v0-lovable-2026) · [Justin McKelvey](https://justinmckelvey.com/blog/best-vibe-coding-tools-2026)
**대시보드/벤토**: [studiomeyer](https://studiomeyer.io/en/blog/bento-grid-layouts) · [orbix.studio](https://www.orbix.studio/blogs/bento-grid-dashboard-design-aesthetics) · [SaaSFrame](https://www.saasframe.io/blog/designing-bento-grids-that-actually-work-a-2026-practical-guide) · [think.design](https://think.design/blog/dashboard-design-in-2026-dos-and-donts/) · [DesignRush](https://www.designrush.com/agency/ui-ux-design/dashboard/trends/dashboard-design-principles) · [UXPilot](https://uxpilot.ai/blogs/dashboard-design-principles) · [Vercel 리디자인](https://vercel.com/changelog/dashboard-navigation-redesign-rollout) · [Fuselab 엔터프라이즈](https://fuselabcreative.com/enterprise-ux-design-guide-2026-best-practices/)
**프로그레시브/시간범위**: [IxDF](https://ixdf.org/literature/topics/progressive-disclosure) · [Grafana 팬·줌](https://grafana.com/whats-new/2026-01-15-time-range-pan-and-zoom/)
**커맨드 팔레트**: [techinterview](https://www.techinterview.org/post/3233475212/build-command-palette-cmd-k/) · [cmdk 셋업](https://www.lmctogetherwebuild.com/cmdk-in-react-build-a-fast-command-palette-setup-examples/) · [UX Patterns](https://uxpatterns.dev/patterns/advanced/command-palette) · [TextExpander](https://textexpander.com/blog/best-command-palette-tools)
**생성형 UI**: [CopilotKit 가이드](https://www.copilotkit.ai/blog/the-developer-s-guide-to-generative-ui-in-2026) · [AG-UI GitHub](https://github.com/ag-ui-protocol/ag-ui) · [CopilotKit/generative-ui](https://github.com/CopilotKit/generative-ui) · [Google A2UI](https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/) · [OpenDataScience](https://opendatascience.com/generative-ui-when-the-agent-builds-the-interface-for-you/)
**Agent UX/챗**: [setproduct](https://www.setproduct.com/blog/ai-chat-interface-ui-design) · [TheFrontKit](https://thefrontkit.com/blogs/ai-chat-ui-best-practices) · [UX Patterns AI챗](https://uxpatterns.dev/patterns/ai-intelligence/ai-chat) · [Fuselab Agent UX](https://fuselabcreative.com/ui-design-for-ai-agents/) · [ProCreator Agentic](https://medium.com/@pro.namratapanchal/what-are-the-must-know-agentive-design-patterns-for-2026-21cf34839a01) · [agentic-design.ai](https://agentic-design.ai/patterns/ui-ux-patterns)
**관측성/대화형 분석**: [Langfuse Sessions](https://langfuse.com/docs/observability/features/sessions) · [Langfuse 신규 Trace View](https://langfuse.com/changelog/2025-03-19-new-trace-view) · [AIMultiple](https://aimultiple.com/agentic-monitoring) · [Laminar](https://laminar.sh/article/2026-04-23-top-6-agent-observability-platforms) · [Confident AI](https://www.confident-ai.com/knowledge-base/compare/best-ai-observability-tools-2026) · [Snowflake Cortex Analyst](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst) · [getdot](https://www.getdot.ai/blog/conversational-analytics-software)
