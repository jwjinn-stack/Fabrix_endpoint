# IMP-74 — 메트릭 소스 / 익스포터 커버리지 매트릭스

> 신호 × 온톨로지 객체 커버리지·갭·3단 상태 (node/ksm/cAdvisor/DCGM/process/blackbox)
> Type: ux (sev=medium, effort=M) · Branch: `feature/evolve-cycle5-active-ontology`

## Why (문제)

focus 방향(3)은 '최대 정보 수집'을 요구한다 — cAdvisor·kube-state-metrics·DCGM 확장·NVML·process/network exporter를
리서치·추천하고 화면으로 노출하라는 것. 그러나 현재 앱은 **node_exporter + DCGM 두 소스만 암시**한다
(`NodeMetrics.tsx` 주석 "node_exporter + Prometheus", `Gpu.tsx` "DCGM 실측"). 어떤 신호를 어떤 익스포터가 주고,
무엇이 아직 안 잡히는지(컨테이너 cgroup=cAdvisor, K8s 오브젝트 상태=kube-state-metrics, GPU per-process=NVML/DCGM 한계,
TCP retransmit=node/process/blackbox)를 보여주는 **커버리지 화면이 없다**.

`Diagnostics.tsx`(연동 상태)는 **외부 의존성 능동 프로브**(DNS/TCP/TLS·도달성)만 한다 — '메트릭 소스 인벤토리'가 아니다.
이 화면은 그와 명확히 구분되는, Grafana Entity-catalog / OTel-coverage 방식의 **'신호→온톨로지 객체 커버리지 매트릭스'**다.

## What (구현 — backlog Fix 정확 반영)

새 화면 **'메트릭 소스'**(`/metric-sources`)를 연동(Integrate) 그룹에 신설. "연결 카드 나열"이 **아니라**:

### (1) 소스 축(익스포터) — signal provider 추상
6개 익스포터 카드: `node_exporter` / `kube-state-metrics` / `cAdvisor` / `DCGM-exporter` / `process-exporter` / `blackbox-exporter`.
각 카드 = **제공 메트릭 계열**(families) + **대상 온톨로지 객체 타입**(Node/GpuDevice/Model pod/Endpoint) + **상태** + `protocol`(prometheus|otlp, OTel 정합).

- **NVML은 독립 카드 금지** (DCGM 하위 라이브러리). DCGM 카드 **안**에 `per-process = 미지원(알려진 갭, 이슈 #521)` 배지로 표기 → 잘못된 신뢰 방지.

### (2) 커버리지 갭 — '신호 × 객체' 셀 1급 노출
GAP 셀(각 클릭 → 스파이크 플랜/추천 익스포터로 링크, IMP-71 드릴다운/IMP-72 감지 grounding에 연결):
- `GpuDevice × per-process-memory` = GAP("DCGM/NVML 원천 한계, time-slicing 파드 귀속 불가", 이슈 #521) → GpuDevice 드릴다운(gpu)
- `Model pod × container-memory-pressure` = GAP("cAdvisor 필요") → 추천 익스포터=cAdvisor
- `Endpoint × TCP-retransmit` = GAP("node/process-exporter 또는 blackbox 필요") → 추천 익스포터=blackbox/node
- 커버된 셀(예: Node×cpu/mem=HEALTHY via node_exporter)도 함께 그려 매트릭스가 '무엇이 되고 무엇이 갭인지' 한눈에.

### (3) 3단 상태 판정 (mock 결정적 / 실 스왑 준비)
`NOT_CONFIGURED` → `CONFIGURED_NO_DATA` (up=1이지만 `scrape_samples_scraped=0` 또는 last-scrape age 초과) → `HEALTHY`(신선).
실 상태 = VictoriaMetrics `up{job}` + `scrape_samples_scraped` + last-scrape age (**up 단독 금지** — "타깃 살아있는데 계열 빔"까지 탐지).
실 수집은 IMP-79 spike — **mock-first**, 깨끗한 스왑을 위해 `up`/`scrape_samples_scraped`/`last_scrape_age_sec` 필드를 스키마에 명시.

### (4) OTel 정합
각 소스에 `protocol: "prometheus" | "otlp"` 필드 — 향후 OTel Collector 리시버로 흡수 가능한 signal-provider 추상.

## How (설계)

- **타입**(`types.ts`): `MetricSourceStatus`(3단 enum), `SignalCoverage`(신호 셀: covered|gap + reason + recommended exporter + drilldown 힌트),
  `MetricSourceCard`(id/label/protocol/families/targetTypes/status/scrape 필드/notes 배지), `MetricSourceCoverage`(응답 래퍼: sources + gaps 매트릭스).
- **mock**(`mock.ts`): `genMetricSourceCoverage()` — 결정적 카탈로그(seed 고정). `up`/`scrape_samples_scraped`/`last_scrape_age_sec`에서 3단 상태를
  **파생 함수 `deriveSourceStatus()`로 판정**(실 스왑 시 동일 함수 재사용). GAP 셀은 온톨로지 스냅샷과 무관한 정적 커버리지 지식이지만
  대상 객체 타입은 온톨로지 ObjectType과 정합. route에 `GET /metric-sources` 등록.
- **client**(`client.ts`): `fetchMetricSourceCoverage()` — `getJSON<MetricSourceCoverage>("/metric-sources")`.
- **화면**(`pages/MetricSources.tsx`): 상단 요약(HEALTHY/무데이터/미구성 카운트) → 소스 카드 그리드(families·targetTypes·status·protocol, DCGM 카드 내 NVML 갭 배지)
  → '커버리지 갭' 섹션(신호×객체 GAP 셀, 클릭 → `onNavigate`로 gpu/nodes/investigate 드릴다운 또는 추천 익스포터 카드로 스크롤).
  Diagnostics와 구분되는 카피 명시("의존성 프로브가 아니라 메트릭 계열 커버리지").
- **배선**(같은 패스): `Layout.tsx` NAV 연동 그룹에 '메트릭 소스' 추가 + `router.ts` ROUTES/PAGE_CAP(cap=dashboard) + `App.tsx` switch + `Page` 유니온.
  `Layout.nav.test.tsx` T4(ROUTES ≡ nav) 회귀 가드 갱신 필수.

## 테스트 케이스 (Vitest)

- **mock 파생**: `GET /metric-sources`가 6개 소스 반환 · 각 소스에 targetTypes(온톨로지 ObjectType)·protocol·families 존재.
- **3단 상태 파생**: `deriveSourceStatus` — up=0 → NOT_CONFIGURED · up=1&samples=0 → CONFIGURED_NO_DATA · up=1&age초과 → CONFIGURED_NO_DATA · up=1&fresh&samples>0 → HEALTHY. (up 단독으로 HEALTHY 판정 안 함)
- **NVML 규칙**: 소스 목록에 `nvml`/`NVML` 독립 카드 **없음**. DCGM 카드에 per-process 미지원 갭 배지(이슈 #521) 존재.
- **GAP 셀**: 3개 GAP(GpuDevice×per-process-memory / ModelPod×container-memory-pressure / Endpoint×TCP-retransmit) 존재 · 각 reason 카피 정확 · recommended/drilldown 힌트 존재.
- **화면 렌더**(RTL): 소스 카드가 targetTypes·status와 함께 렌더 · GAP 셀이 렌더되고 **클릭 가능**(onNavigate 호출 또는 링크) · NVML이 독립 카드로 안 뜸.
- **route/nav 등록**: ROUTES에 `metric-sources` · Layout nav 연동 그룹에 노출 · PAGE_CAP=dashboard.
- **empty/error**: fetch reject 시 error 상태 · 소스 0건 시 empty 안내.

## Out of scope
- 실 up/scrape 수집(IMP-79 spike). 여기선 mock-first + 깨끗한 스왑 구조만.
- 익스포터 실 배포/Helm(IMP-79). GPU 하드웨어 필드 확장(IMP-76 완료).

## Security (light-check)
mock/UI 전용. 자격증명·시크릿 비노출. 사용자 입력 없음(read-only 조회). injection 표면 없음.
