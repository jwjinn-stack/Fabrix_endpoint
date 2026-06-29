# FABRIX Endpoint — 심미성·편의성 수정 명세 (경로별)

> 목적: 기능이 아니라 **심미성(aesthetic)·사용자 편의성(UX)** 개선을 경로별로 구체화.
> 짝 문서: [ui-ux-path-audit.md](./ui-ux-path-audit.md)(기능/안전), [ui-ux-research-2026.md](./ui-ux-research-2026.md)(원칙).
> 기준: 실제 화면 스크린샷 리뷰(2026-06-29). 파일/라인은 작성 시점 기준 — 적용 전 재확인.

---

## 0. 공통 원칙 (이번 수정의 4축)
1. **빈 공간(void) 제거** — 행/콘텐츠가 적은 페이지의 휑한 영역을 요약 스트립·2컬럼·빈상태 안내로 채운다.
2. **색 절제** — 카테고리 색에 의미색(amber=경고, pink=PII, red=위험)을 섞지 않는다. 분포는 **단일 색 명도 단계**.
3. **아이콘 통일** — 이모지 제거, 색 점/라인 글리프로.
4. **일관성** — 행밀도 토글·요약 스트립 같은 패턴을 유사 페이지에 동일 적용.

---

## C. 공통 컴포넌트 수정

### C-1. StackedShareBar 팔레트 → 단일 색 명도 램프
- **현재**: `components/StackedShareBar.tsx:9-16` PALETTE = primary·teal·blue·amber·pink·primary-lite (의미색 혼입).
- **무엇을**: 분포 세그먼트를 액센트 단일 색의 명도 단계로 교체(브랜드색 자동 추종).
- **어떻게**:
  ```ts
  // 단일 색 램프 — --primary 를 surface 와 섞어 명도 단계 생성(액센트 변경 시 자동 반영)
  const PALETTE = [
    "var(--primary)",
    "color-mix(in srgb, var(--primary) 78%, var(--surface))",
    "color-mix(in srgb, var(--primary) 60%, var(--surface))",
    "color-mix(in srgb, var(--primary) 45%, var(--surface))",
    "color-mix(in srgb, var(--primary) 33%, var(--surface))",
    "color-mix(in srgb, var(--primary) 24%, var(--surface))",
  ];
  ```
- **영향**: Usage 모델/부서/앱/키 점유율 바, 토큰 분해 바가 차분한 단일 톤으로.

### C-2. 요약 스트립 컴포넌트 신설 — `SummaryStrip`
- **무엇을**: 리스트 페이지 상단의 빈 공간을 채우고 한눈 요약을 주는 미니 칩 줄.
- **어떻게**: `components/SummaryStrip.tsx` 신설.
  ```tsx
  // 리스트 상단 요약 칩 줄 — 테이블 위 한 줄로 "전체 상태"를 먼저 보여준다(요약 우선).
  export interface SummaryItem { label: string; value: React.ReactNode; tone?: "green" | "amber" | "red" | "default"; }
  export default function SummaryStrip({ items }: { items: SummaryItem[] }) {
    return (
      <div className="summary-strip">
        {items.map((it) => (
          <div key={it.label} className={`summary-chip ${it.tone ?? "default"}`}>
            <span className="sc-val">{it.value}</span>
            <span className="sc-label">{it.label}</span>
          </div>
        ))}
      </div>
    );
  }
  ```
- **CSS**(`index.css`):
  ```css
  .summary-strip { display: flex; flex-wrap: wrap; gap: 1px; background: var(--hair, var(--border)); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; margin-bottom: var(--sp-4); }
  .summary-chip { flex: 1; min-width: 120px; background: var(--surface); padding: 12px 16px; display: flex; flex-direction: column; gap: 2px; }
  .summary-chip .sc-val { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
  .summary-chip .sc-label { font-size: var(--fs-xs); color: var(--text-dim); }
  .summary-chip.green .sc-val { color: var(--green); }
  .summary-chip.amber .sc-val { color: var(--amber); }
  .summary-chip.red .sc-val { color: var(--red); }
  ```

---

## 1. `/dashboard` — 관제

### D-1. 헬스배너 위험 신호 강조
- **현재**: `pages/Dashboard.tsx` HealthBanner — 위험 등급이어도 우측 4신호가 작은 점+텍스트라 임팩트 약함.
- **무엇을**: 종합 등급이 red/amber일 때 **해당 등급 신호의 값**을 더 굵게+색으로, 배너 배경에 아주 옅은 틴트.
- **어떻게**(`index.css`):
  ```css
  .health-banner.red { background: color-mix(in srgb, var(--red) 4%, var(--surface)); }
  .health-banner.amber { background: color-mix(in srgb, var(--amber) 4%, var(--surface)); }
  .health-sig.red, .health-sig.amber { font-weight: 600; }
  .health-sig.red .health-sig-dot, .health-sig.amber .health-sig-dot { width: 8px; height: 8px; }
  ```
- **그리고**: `.health-status`(등급 라벨) 폰트 크기 `var(--fs-card-title)`→`14px`, 점에 글로우 유지.

### D-2. 가드레일 카드 시각 무게 완화
- **현재**: `Dashboard.tsx` 가드레일 StatCard 의 "차단" 큰 빨강 숫자가 옆 2카드보다 과하게 튐.
- **무엇을**: 차단 0건일 때는 red 톤을 빼고 중립으로(문제 없을 때 빨강 남발 방지).
- **어떻게**: 메트릭 tone 을 조건부 — `tone: overview.guardrail.blocked > 0 ? "red" : undefined`.

---

## 2. `/usage` — 사용량

### U-1. 점유율 바 단일 톤 (C-1 로 자동 해결)
- C-1 적용으로 모델별 점유율·토큰 분해가 단일 블루 램프가 됨. 추가 작업 없음.

### U-2. 비용 카드 색 정리
- **현재**: `pages/Usage.tsx:148-151` 추정비용 카드의 최고비용 항목 `tone: "amber"`.
- **무엇을**: amber(경고색)를 빼고 중립 라벨로 — 비용은 경고가 아니라 정보.
- **어떻게**: 해당 metric 의 `tone: "amber" as const` 제거(라벨만 유지).

---

## 3. `/gpu` — GPU/MIG

### G-1. 온도 카드 6+1 불균형 해소
- **현재**: `index.css:1055 .cards-6 { grid-template-columns: repeat(6,1fr) }` → 7번째(온도) 카드가 2행에 홀로.
- **무엇을**: 7장이 한 행에 고르게 들어가도록 auto-fit 그리드로.
- **어떻게**(`index.css`):
  ```css
  .cards-6 { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--sp-4); margin-bottom: var(--sp-4); }
  /* 기존 @media repeat(3)/repeat(2) 미디어쿼리는 삭제(auto-fit 이 대체) */
  ```
- **검증**: 1440px 사이드바 제외 ~1230px / 150 ≈ 7 → 한 줄. 좁아지면 자동 줄바꿈.

---

## 4. `/traffic` — 트래픽

### T-1. 병목 단계 박스 강조
- **현재**: `pages/Traffic.tsx` 병목 표시는 작은 amber 점("● 병목")뿐.
- **무엇을**: 병목 노드 박스 자체에 옅은 amber 테두리/배경.
- **어떻게**: 병목인 `.pipe-node` 에 `pipe-node-bottleneck` 클래스 부여 + CSS:
  ```css
  .pipe-node.pipe-node-bottleneck { border-color: var(--amber-border); background: var(--amber-weak); }
  ```
  Traffic.tsx 엔진/가드레일 노드 className 에 조건부 추가.

---

## 5. `/endpoints` — 엔드포인트

### E-1. 행 액션 hover-reveal (버튼 밭 제거)
- **현재**: `pages/Endpoints.tsx:336-349` 행마다 로그/키발급/삭제 3버튼 상시 노출 → 우측 버튼 밭.
- **무엇을**: 평소엔 흐리게(숨김), 행 hover/포커스 시 노출. 키보드 접근 위해 focus-within 유지.
- **어떻게**:
  - 액션 `<td>` 를 `<td className="num row-actions">` 로.
  - CSS:
    ```css
    .usage-table .row-actions { opacity: 0; transition: opacity var(--ease); }
    .usage-table tbody tr:hover .row-actions,
    .usage-table tbody tr:focus-within .row-actions { opacity: 1; }
    @media (hover: none) { .usage-table .row-actions { opacity: 1; } } /* 터치 기기 항상 노출 */
    ```

### E-2. 상단 요약 스트립
- **무엇을**: 테이블 위에 SummaryStrip — 전체/Active/Pending/총 replica.
- **어떻게**: `Endpoints.tsx` 카드 위에:
  ```tsx
  <SummaryStrip items={[
    { label: "전체", value: eps.length },
    { label: "Active", value: eps.filter(e => e.status === "Active").length, tone: "green" },
    { label: "Pending", value: eps.filter(e => e.status !== "Active").length, tone: eps.some(e=>e.status!=="Active") ? "amber" : "default" },
    { label: "총 replica", value: eps.reduce((s,e)=>s+(e.replicas??0),0) },
  ]} />
  ```
  (status/replicas 필드명은 Endpoint 타입에서 확인 후 매핑.)

---

## 6. `/keys` — 키·앱

### K-1. 상단 요약 스트립
- **무엇을**: 활성/회수/예산 임계 초과 수를 요약.
- **어떻게**: `Keys.tsx` 테이블 카드 위 SummaryStrip:
  ```tsx
  <SummaryStrip items={[
    { label: "전체 키", value: keys.length },
    { label: "활성", value: keys.filter(k=>k.enabled).length, tone: "green" },
    { label: "회수됨", value: keys.filter(k=>!k.enabled).length },
    { label: "예산 임계 초과", value: keys.filter(k=>k.quota_tpd && (k.tokens_today??0)/k.quota_tpd >= (k.alert_threshold??0.8)).length, tone: "amber" },
  ]} />
  ```

---

## 7. `/models` — 모델

### M-1. 운영칩 1줄 고정 + 넘침 생략
- **현재**: `index.css .model-ops` 칩이 폭 좁아지면 2줄로 흐트러져 카드 높이 불균형.
- **무엇을**: 칩 줄을 nowrap + 가로 스크롤 숨김(상세는 SlidePanel 에 전체).
- **어떻게**(`index.css`):
  ```css
  .model-ops { display: flex; flex-wrap: nowrap; gap: 4px; overflow: hidden; }
  .model-ops .ops-chip { flex: none; white-space: nowrap; }
  ```
- 비고: 모델 페이지는 완성도 높음 — 이 1건만.

---

## 8. `/playground` — 플레이그라운드

### P-1. 빈 상태 추천 프롬프트 칩
- **현재**: `pages/Playground.tsx:361` 빈 대화 영역이 매우 큼(휑함).
- **무엇을**: 빈 상태에 추천 프롬프트 칩 3~4개 → 클릭 시 입력창에 채움(첫 사용 편의 + void 제거).
- **어떻게**:
  ```tsx
  {turns.length === 0 && (
    <div className="pg-empty">
      <p className="empty" style={{margin:0}}>메시지를 입력해 모델을 시험해 보세요.</p>
      <div className="pg-suggest">
        {["한 문장으로 요약해줘", "이 코드의 버그를 찾아줘", "표로 정리해줘", "쉬운 말로 설명해줘"].map(s => (
          <button key={s} type="button" className="pg-suggest-chip" onClick={() => setInput(s)}>{s}</button>
        ))}
      </div>
    </div>
  )}
  ```
- **CSS**:
  ```css
  .pg-empty { display: flex; flex-direction: column; align-items: center; gap: var(--sp-4); margin-top: 12vh; }
  .pg-suggest { display: flex; flex-wrap: wrap; gap: var(--sp-2); justify-content: center; max-width: 420px; }
  .pg-suggest-chip { border: 1px solid var(--border-strong); background: var(--surface); color: var(--text-dim); border-radius: 999px; padding: 6px 14px; font: inherit; font-size: var(--fs-sm); cursor: pointer; transition: border-color var(--ease), color var(--ease); }
  .pg-suggest-chip:hover { border-color: var(--primary); color: var(--primary); }
  ```

---

## 9. `/eval` — 평가

### EV-1. 빈 상태 안내 카드
- **현재**: `pages/Eval.tsx` 실행 전 결과 영역 전체 공백.
- **무엇을**: 폼 아래에 "이렇게 동작합니다" 안내 카드(결과 0건일 때만).
- **어떻게**:
  ```tsx
  {results.length === 0 && !busy && (
    <div className="card eval-guide">
      <div className="empty" style={{textAlign:"left"}}>
        <b>LLM-as-judge 평가</b><br/>
        대상 모델의 응답을 심판 모델이 1~5점으로 채점합니다. 모델 교체·양자화 전후 같은 프롬프트를 반복 실행해 점수 회귀를 확인하세요.
        결과는 이 영역에 누적되고, 2건 이상이면 추이 차트가 나타납니다.
      </div>
    </div>
  )}
  ```

---

## 10. `/guard` — 가드레일

### GD-1. 능력 카드 아이콘 통일 (이모지 제거)
- **현재**: `components/GuardOverview.tsx:10-13` CAPS icon = `◑ ⚠ 🔑 ◆` (이모지/글리프 혼재).
- **무엇을**: 이모지 글리프 제거 → 색 점(dot)으로 통일. 각 능력 색(c.color)을 점으로.
- **어떻게**:
  - JSX `pages`/component: `<span className="cap-icon" .../>{c.icon}` → 글리프 대신 점:
    ```tsx
    <span className="cap-dot" style={{ background: c.color }} aria-hidden="true" />
    ```
  - CAPS 의 `icon` 필드 제거(또는 미사용).
  - CSS:
    ```css
    .cap-dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
    ```

---

## 11. `/traces` · `/sessions` — 트레이스·세션

### TR-1. 행밀도 토글 추가 (일관성)
- **현재**: 매우 조밀한 테이블인데 밀도 조절 없음(Endpoints/Keys 에는 있음).
- **무엇을**: 두 페이지 테이블에 DensityToggle 적용(기존 훅 재사용).
- **어떻게**:
  - `pages/Traces.tsx`: `const { density, setDensity } = useTableDensity("traces");` → page-head 에 `<DensityToggle .../>`, 테이블 className 에 `density-${density}`.
  - `pages/Sessions.tsx`: 동일(`"sessions"`).
  - 단, 트레이스 워터폴이 아니라 **목록 테이블**에만 적용.

---

## 12. `/settings/credentials` — 자격증명

### CR-1. 2컬럼 레이아웃 (우측 void 제거)
- **현재**: `index.css .cred-list { max-width: 720px }` → 넓은 화면 우측 절반 빔.
- **무엇을**: 카드 2장을 나란히(2컬럼).
- **어떻게**(`index.css`):
  ```css
  .cred-list { max-width: 1040px; display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--sp-4); }
  @media (max-width: 900px) { .cred-list { grid-template-columns: 1fr; } }
  ```
  (기존 `flex-direction: column` 제거.)

---

## 13. `/diagnostics` — 연동 상태

### DG-1. 타일 간격 확대
- **현재**: 의존성 타일 그리드가 빽빽.
- **무엇을**: 타일 gap 한 단계 ↑ + 최소폭 약간 ↑로 숨통.
- **어떻게**: 타일 그리드 클래스(예 `.diag-grid`) gap 을 `var(--sp-3)`→`var(--sp-4)`, minmax 하한 +20px. (클래스명은 Diagnostics.tsx 에서 확인 후.)

---

## 실행 순서 & 검증
1. 공통(C-1 팔레트, C-2 SummaryStrip + CSS) → 의존 페이지부터.
2. 페이지별 1~13 적용.
3. `tsc --noEmit` + `vite build`.
4. dev 서버 + 브라우저 인터랙션 QA: 각 경로 스크린샷으로 before/after 확인, 콘솔 0 유지.

## 범위 밖(이번 제외)
- Endpoints 케밥 드롭다운(상태/외부클릭 처리 비용) → hover-reveal 로 대체(E-1).
- 다크모드 커스텀 브랜드 틴트 한계(별도 과제, ui-ux-path-audit §0.2).
