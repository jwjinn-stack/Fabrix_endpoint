# IMP-64 — Object View / 관계 그래프 시각 언어 (타입 위계·관계 엣지·상태 인코딩)

- Type: aesthetic (sev=low)
- Depends on: IMP-57(ObjectView), IMP-63(Ontology 화면/스키마 그래프) — 둘 다 done
- Branch: feature/evolve-cycle4-ontology
- Date: 2026-07-01

## 문제 (flat spots)
IMP-57 ObjectView + IMP-63 Ontology 카탈로그/스키마 그래프가 상속한 "평평한" 패턴:

1. **타입 위계 없음** — `TYPE_META`(글리프+라벨)가 ObjectView.tsx / Ontology.tsx / Investigate.tsx 3곳에 중복 정의됐고,
   글리프 색이 전부 `--text-dim` 무채색. Model/Endpoint/Service/GpuDevice/Node/Trace/Incident 가
   시각적으로 구분되지 않음(Palantir Workshop / Linear 는 noun-type 별 아이콘+색 위계).
2. **상태가 텍스트 배지뿐** — ObjectView header 는 `Badge` 하나. 상태 강도(정상↔위험)가 밴드/게이지로
   인코딩되지 않음(IMP-54 Gauge 는 이미 있는데 header 에 안 씀).
3. **관계 방향이 무의미한 화살표** — Related 이웃은 `→`/`←` 만. linkKind 별 의미(serves/runsOn/…) 방향
   지시자가 없고, 이웃 카드 hover 에 elevation(그림자 lift)이 없음.
4. **스키마 그래프 엣지가 무채색** — TopologyView 스키마 그래프 엣지는 `edgeColor(error_rate)` 가
   `error_rate` 없으면 `--border-strong` 로 떨어져 전부 회색. 관계 밀도(count→두께)는 있지만
   상태(끝점 worst) 색 인코딩이 없음.

## 목표 (구현 범위 — 정확히 이것만)
1. **단일 출처 `objectTypeVisual` 맵** (`web/src/api/objectTypeVisual.ts`): ObjectType 별
   `{ glyph, label, color(CSS var), tint(약한 배경 CSS var), className }`. 스틸블루 계열/라이트/엔터프라이즈,
   **네온 금지**. ObjectView·Ontology·Investigate 가 공통 소비(중복 TYPE_META 제거 또는 위임).
2. **ObjectView header**: 타입 칩(글리프+색, `.otype-chip`) + 상태 게이지 밴드(IMP-54 `Gauge` 재사용) —
   맨 텍스트 상태 대신. 기존 상태 Badge 는 (색-only 금지·텍스트 대체 위해) 유지 병기.
3. **Related 섹션**: linkKind 별 방향 지시자(예 `→ serves`, `⇊ runsOn`) — 의미 라벨 + 방향 글리프.
   이웃 카드 hover elevation(`--shadow-card-hover`).
4. **스키마 그래프 엣지**: 의미 라벨은 이미 "관계 정의" 표에 있음(유지). TopologyView 에 **가법적**
   `edgeStatus` prop(옵션) 추가 — 스키마 그래프가 끝점 worst 상태를 엣지 색으로 실어보냄.
   `layout.ts` geometry 수식은 **건드리지 않음**(엣지 stroke 색만 추가 인코딩).
5. **인라인 스타일 → 토큰/유틸 클래스** 수렴 — 손대는 표면만(레포 전체 sweep 금지).

## 비목표
- layout.ts geometry 변경 금지.
- 다른 백로그 항목/화면 손대기 금지.
- 신규 prod 의존성 금지(mock-first, self-SVG).
- 신규 색상 하드코딩 금지 — 기존 토큰(--primary/--teal/--brand-gray/--amber/--pink/--red 계열)에서만 파생.

## 설계

### objectTypeVisual (단일 출처)
```
Model     ◆  모델        --primary        (스틸블루 — 제품 심장)
Endpoint  ▣  엔드포인트  --primary-strong (진한 블루 — 노출 표면)
Service   ◈  서비스      --teal           (청록 — 논리 서비스, 블루와 구분)
GpuDevice ▤  GPU         --brand-gray-strong (그레이 — 물리 자원)
Node      ▥  노드        --brand-gray-strong (그레이 — 물리 자원, 최상류)
Trace     ≣  트레이스    --blue           (인디고 — 실행 궤적)
Incident  ▲  인시던트    --red            (위험 — 항상 경계색)
```
- 각 타입 색은 `color`(전경) + `tint`(약한 배경, `--*-weak` 또는 color-mix) + `className`(`otype-model` 등)으로.
- 글리프는 기존 3곳과 **동일** 유니코드(◆▣◈▤▥≣▲) — 위계는 색으로 준다(글리프 교체 아님, 회귀 최소).

### 상태 게이지 밴드 (ObjectStatus → Gauge)
- Gauge 는 수치(value/warn/crit) 입력. ObjectStatus 를 밴드 위치로 매핑:
  `ok→0.3, warn→0.8, crit→1.0, unknown→0` (warn=0.75, crit=0.9, max=1 고정).
  → ok 는 primary 채움(밴드 좌측), warn 은 amber, crit 은 red 로 자동 안착.
- 색-only 금지: 옆에 기존 상태 Badge(텍스트) 병기 유지.

### CSS (추가형, index.css)
- `.otype-chip` — 글리프+색 인라인 칩(타입 위계). `--otype-color`/`--otype-tint` CSS 변수로 색 주입.
- `.ov-type-row` / `.ov-status-band` — header 칩+게이지 레이아웃.
- `.ov-neighbor:hover { box-shadow: var(--shadow-card-hover) }` — elevation.
- `.ov-link-dir` — linkKind 방향 지시자(글리프+라벨).
- prefers-reduced-motion: hover elevation transition 은 전역 reduce 규칙이 이미 0.01ms 로 눌러줌(추가 안전).

## 테스트 케이스 (Vitest)
1. **objectTypeVisual 맵** — 7개 ObjectType 전부 항목 존재, glyph/label/color/className 비어있지 않음.
2. **타입 칩 렌더** — ObjectView header 에 `.otype-chip.otype-<type>` 이 대상 타입으로 렌더(Model→otype-model 등).
3. **상태 밴드 반영** — status=crit 객체 → header Gauge fill 색 = var(--red)(위험); warn → amber; ok → primary.
4. **관계 방향 지시자** — 각 linkKind 그룹에 `.ov-link-dir` 방향 글리프+의미 라벨 렌더(serves/runsOn/affects).
5. **props 누락 crash 없음** — 미존재 id(빈 상태)에서 칩/게이지 미렌더, throw 없음.
6. **reduce-motion 안전** — 신규 애니 없음(hover elevation 은 box-shadow transition 뿐, 전역 reduce 로 정지) — 회귀 없음 확인(기존 테스트 유지).

## TOUCHED_SURFACES (design-review 용)
- ObjectView 헤더(타입 칩+상태 게이지 밴드), Related 이웃 카드(방향 지시자·hover lift)
- Ontology 카탈로그 카드 글리프 색(타입 위계), Link Types 스키마 그래프 엣지 상태색
- Investigate hop 카드 글리프 색(공통 소스 위임으로 자동 반영)
