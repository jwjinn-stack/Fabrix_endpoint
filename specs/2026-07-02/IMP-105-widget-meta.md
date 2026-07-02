# IMP-105 — 위젯·영역 메타 선언(widgetMeta.ts) + '이 숫자 좋은가/나쁜가' + 근거 인용

- Type: ux (sev=medium, effort=M)
- Branch: feature/evolve-cycle8-assist
- Date: 2026-07-02

## 문제
대시보드 카드·KPI·패널이 '무엇을 측정하고 좋음/나쁨 기준이 뭔지' 선언적 메타가 없다.
어시스트(IMP-106 MCP describe_widget/get_screen_context)가 '이 숫자 좋은가 나쁜가'를
즉답하거나 '이 화면 설명'을 근거 인용하려 해도 참조할 위젯 메타데이터가 부재.
Grafana Assistant는 패널 정의를 컨텍스트로 받아 설명하는데(2025-08 preview) 여기엔 그 계약이 없다.

## 설계 원칙
1. **얇은 선언적 레지스트리** — widget id → { title, whatItShows, goodBadRef, relatedTerms[] }.
2. **단일 출처(no inline numbers)** — goodBadRef 는 IMP-7 임계 카탈로그 키(AlertMetric) + 방향만
   가리킨다. 좋음/나쁨 판정은 답변 시점에 라이브 값 vs 참조 임계에서 **파생**한다. widgetMeta 에
   숫자를 인라인하지 않는다(임계가 바뀌면 IMP-7 카탈로그 한 곳만 고친다).
3. **정보폭탄 금지** — getScreenContext(route)는 그 화면에 마운트된 위젯 id + 메타만 준다(앱 전체 덤프 금지).
4. **HARD grounding** — describeWidget(미지 id) → "선언된 메타 없음". 환각 금지.
5. **relatedTerms 재사용** — IMP-108 glossary key 를 가리킨다(용어 정의 단일 출처).
6. **passive 노출** — InfoTip/EvidencePanel 이 어시스트 없이도 사람이 self-document 하게 whatItShows·
   good/bad 기준을 표면에 드러낸다(선택적, 회귀 0).

## IMP-7 임계 카탈로그 참조 형태(확인됨)
- `web/src/api/types.ts` — `AlertMetric = "ttft_p95"|"latency_avg"|"error_rate"|"block_rate"|"throughput"|"count"`,
  `AlertMetricMeta = { key, title, unit, lower_better }`, `AlertRule = { metric, op, alert_threshold, warn_threshold? }`.
- `web/src/api/mock.ts` — `ALERT_METRIC_CATALOG`(키+lower_better) + `ALERT_RULES`(기본 임계).
- describeWidget 은 **순수·동기**여야 하므로(MCP resource 파생) fetch 불가.
  → `web/src/api/thresholdCatalog.ts` 에 IMP-7 카탈로그의 **정적 단일 출처**(키·lower_better·기본 임계)를
    순수 상수로 승격하고, mock.ts 의 ALERT_METRIC_CATALOG/ALERT_RULES 가 이를 파생하게 한다(중복 제거).
  → goodBadRef.metric 은 AlertMetric 키. verdict = deriveVerdict(catalog[metric], liveValue).

## 구현
### 신규 `web/src/api/thresholdCatalog.ts`
- `THRESHOLD_CATALOG: Record<AlertMetric, { title, unit, lowerBetter, warn, alert }>` — IMP-7 단일 출처.
- `metricThreshold(key): entry | undefined` — 미지 키 undefined.
- `deriveVerdict(key, value): { verdict: "good"|"warn"|"bad"|"unknown", citation, thresholdText }` —
  lowerBetter 면 value≥alert→bad, ≥warn→warn, else good. higher-better 면 반대.
  키 미지/값 미제공 → unknown(파생 불가). citation 은 "임계 warn/alert (IMP-7 catalog: {key})".
- mock.ts 의 ALERT_METRIC_CATALOG·ALERT_RULES 는 이 카탈로그에서 파생(런타임 계약 회귀 0).

### 신규 `web/src/components/widgetMeta.ts`
- `WidgetMeta = { title, whatItShows, goodBadRef?: { metric: AlertMetric; direction: "lower-better"|"higher-better" }, relatedTerms: string[] }`.
- `WIDGET_META: Record<string, WidgetMeta>` — 고트래픽부터: dashboard.traffic / dashboard.quality /
  dashboard.guardrail / dashboard.gpu (Dashboard StatCard 4종). goodBadRef 는 카탈로그 키만.
- `SCREEN_WIDGETS: Partial<Record<Page, string[]>>` — 화면(route)에 마운트된 위젯 id 목록(on-screen only).
- `getScreenContext(route): { route, widgets: {id, meta}[] }` — 해당 화면 위젯만(정보폭탄 방지).
- `describeWidget(id, liveValue?): { found, id, title?, whatItShows?, verdict?, relatedTerms? } | { found:false, message:"선언된 메타 없음" }`
  — 메타 있으면 전체 + goodBadRef 있으면 deriveVerdict(liveValue) 인용. 없으면 "선언된 메타 없음".
- `widgetRelatedTerms(id): GlossaryTerm[]` — relatedTerms 를 glossary 로 해석(미지 term skip, 환각 금지).

### data-widget-id 부착(점진)
- StatCard/StatMini: optional `widgetId?: string` prop → 루트 div `data-widget-id={widgetId}`.
- MetricLayout SummaryStrip: optional `widgetId?` → 컨테이너 data-widget-id.
- Dashboard: traffic/quality/guardrail/gpu StatCard 에 widgetId 부착(고트래픽 KPI 우선).

### passive 노출
- StatCard: widgetId 가 있고 meta 가 있으면, info 툴팁이 없을 때 whatItShows 를 InfoTip 으로 보조 노출(선택적, 회귀 0 — 기존 info 우선).

## 테스트 케이스 (`web/src/components/widgetMeta.test.ts`)
1. **registry shape** — WIDGET_META 모든 항목이 title·whatItShows·relatedTerms[] 보유. goodBadRef 있으면 metric 이 THRESHOLD_CATALOG 유효 키.
2. **getScreenContext on-screen only** — getScreenContext("dashboard")는 dashboard.* 위젯만, 다른 화면 위젯 미포함(정보폭탄 방지). 미지 route → 빈 widgets.
3. **describeWidget good/bad derived from threshold** — describeWidget("dashboard.quality", 낮은값)=good, (alert 초과값)=bad, verdict citation 에 IMP-7 카탈로그 키 포함. widgetMeta 에 인라인 숫자 없음(카탈로그에서 파생).
4. **unknown widget → "선언된 메타 없음"** — describeWidget("nope") = { found:false, message:"선언된 메타 없음" }.
5. **relatedTerms → glossary** — widgetRelatedTerms(id)가 glossary term 으로 해석되고 미지 term 은 제외.
6. **thresholdCatalog 파생 정합** — deriveVerdict lower-better/higher-better 방향 정확, 값 미제공 → unknown.

## 검증
- `cd web && npm run test` (기존 card/isolation IMP-88 green 유지) + `npm run build` 통과.
- Security light-check: 정적 메타 + 순수 파생, dangerouslySetInnerHTML 없음, 외부 입력 보간 없음 → clean.

## Out of scope
- IMP-106 MCP resource/tool 배선(widget:// resource template)은 다음 아이템.
- 전 화면 data-widget-id 완전 부착(점진 — 이번엔 Dashboard 고트래픽 KPI).
