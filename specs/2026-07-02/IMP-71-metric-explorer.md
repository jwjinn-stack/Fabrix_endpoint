# IMP-71 — GPU·노드 전량-메트릭 드릴다운 — 엔티티 앵커 Metric Explorer

- **Type**: ux (sev=high, effort=L)
- **Branch**: `feature/evolve-cycle5-active-ontology`
- **Date**: 2026-07-02
- **Depends/합류**: IMP-76A(GpuDevice.hw 풀 필드), IMP-81(요청단위 스냅샷 메모이즈), IMP-30(행 windowing), IMP-54(Gauge)·Sparkline. 실 수집은 IMP-79 spike(out of scope).

## 배경 / 문제 (curation vs full-dump 긴장)

`Gpu.tsx` SlidePanel 상세는 DCGM ~10필드(util·mem·temp·power·SM·tensor·GR_ENGINE)만,
`NodeMetrics.tsx` 는 `NodePoint` 9필드를 **명시적 큐레이션 세트**로 노출한다. 코드 주석(NodeMetrics.tsx:17)이
"Node Exporter Full(id 1860) 전량 덤프는 안티패턴"이라 못박는다. 이 주석은 **DEFAULT 대시보드**에 대해서만 맞다 —
온콜이 요약을 넘어 근본원인을 파려 할 때(SM/mem clock, PCIe/NVLink throughput, ECC/XID, throttle reason,
per-process, energy) 전량 신호로 내려갈 경로가 지금 없다.

업계 정착 답: **대시보딩 = KNOWNS(큐레이션 USE/RED)** + **explorer = UNKNOWNS(검색가능 전량 드릴다운)**.
이 둘은 orthogonal 하며, explorer 는 안티패턴이 아니라 sanctioned escape hatch (Splunk Observability
Metric Explorer 의 entity→all-metrics→drill 패턴). **온톨로지 객체가 이미 엔티티 앵커**다.

## 해결 (정확히 구현)

엔티티-앵커 **Metric Explorer** 를 ObjectView(GpuDevice/Node)와 상세 SlidePanel(Gpu/NodeMetrics)에 신설한다.

1. **큐레이션 요약이 DEFAULT** — ObjectView 는 `요약`(기존 Properties/관계/Action) 탭이 기본, `전체 메트릭` 은 명시적 탭(escape hatch). Gpu/NodeMetrics SlidePanel 은 기존 USE/RED 상세가 그대로 상단, Metric Explorer 는 하단 접이식 disclosure. **IMP-46 회귀 없음**.
2. **카테고리 트리** — GPU: Utilization / Memory / Clocks / Power·Thermal / Interconnect(PCIe·NVLink) / Errors(ECC·XID) / Throttle / Per-process. Node: CPU / Memory / Disk / Filesystem / Network / Load / Systemd. 각 카테고리 접힘/펼침(collapse/expand). 수백 행 → IMP-30 `VirtualRows` windowing 재사용(펼친 카테고리의 행을 평탄화한 목록에 게이트).
3. **각 메트릭 행** = TYPE(gauge/counter/rate) + UNIT(bytes/MiB/MHz/W/count/%/°C/req/s…) + freshness(초) + 임계 상태(ok/warn/crit) + 미니 스파크라인. raw DCGM 값은 단위 없이는 무의미(FB_USED bytes vs MiB, POWER_USAGE W, ECC counter vs rate).
4. **자유텍스트 검색 + label/tag FACET 필터** — facet(gpu UUID·instance·job·device)로 좁힌 뒤 부분일치 검색(NN/g: faceted nav 25–50% 빠름). facet 은 이 엔티티가 emit 하는 메트릭의 label 값에서 파생.
5. **표준 triad** — loading(skeleton) / empty(0 메트릭) / error(재시도).
6. **pin to curated view 힌트**(nice-to-have) — 각 행에 "요약에 고정" 힌트 텍스트(unknowns→knowns 루프). 실제 mutation 없이 힌트만(간단 유지).

### 백엔드 / 데이터 계약 (mock-first, live 스왑 clean)

새 read 엔드포인트: `GET /ontology/objects/:id/metric-tree?range=` → `ObjectMetricTree`.
- mock: `buildOntology()` 요청단위 스냅샷(IMP-81)에서 대상 객체를 찾아 **결정적** category→metric 트리 파생.
  - GpuDevice: props(util_perc·mem_perc·temp_c·power_w·sm_active·tensor_active·mig_efficiency) + 중첩 `hw`(sm/mem clock, PCIe tx/rx/replay, NVLink L0–L5·total·errors, ECC sbe/dbe vol·agg, XID, throttle mask, per-process VRAM) → 8 카테고리.
  - Node: `buildNodeMetrics(host,…)` 최신 point(cpu/mem/disk util·load1·swap·disk_io·net rx/tx/err) + 파생 filesystem/systemd 대표 메트릭 → 7 카테고리.
  - 각 metric: `key/label/type/unit/value/status/freshness_sec/points/facets`. 미존재 id → null(404). 결정적(같은 id+range 반복 호출 시 카테고리·메트릭·단위 동일).
- live(IMP-79): 동일 스키마를 VictoriaMetrics `/api/v1/series?match[]=` 열거 → 가시 그룹당 배치 `/query`(현재값) + 짧은 `/query_range`(스파크라인, 펼칠 때 lazy) 로 채우면 됨. `fetchObjectMetricTree` transport 만 스왑.

## 파일 변경

- `web/src/api/types.ts` — `MetricType`, `MetricRow`, `MetricCategory`, `MetricFacet`, `ObjectMetricTree` 추가(additive; 기존 타입 무수정).
- `web/src/api/mock.ts` — `objectMetricTree(id, range)` 파생 + route `GET …/metric-tree` + 순수 export(테스트용). buildOntology/IMP-76 hw/IMP-81 스냅샷은 **읽기만**(additive).
- `web/src/api/client.ts` — `fetchObjectMetricTree(id, range?, signal?)`.
- `web/src/components/MetricExplorer.tsx` — 신규. 트리+검색+facet+windowing+triad. Sparkline·VirtualRows 재사용.
- `web/src/components/ObjectView.tsx` — GpuDevice/Node 일 때 `요약`/`전체 메트릭` 탭 바 추가(그 외 타입은 탭 없이 기존 그대로).
- `web/src/pages/Gpu.tsx`, `web/src/pages/NodeMetrics.tsx` — SlidePanel 하단에 `<MetricExplorer entityId=…>` disclosure(요약 유지).
- `web/src/index.css` — `.me-*`(tabs/tree/row/facet/status) 클래스. 라이트+스틸블루 토큰, reduce-motion 안전.

## 데이터 계약 (types.ts)

```ts
export type MetricType = "gauge" | "counter" | "rate";
export interface MetricRow {
  key: string;        // DCGM/node exporter 원본 메트릭명(예: DCGM_FI_DEV_FB_USED)
  label: string;      // 사람용 라벨
  type: MetricType;   // gauge=순간값, counter=단조누적, rate=초당
  unit: string;       // bytes|MiB|MHz|W|°C|count|%|req/s|load|""
  value: number;      // 현재값(points 끝점)
  status: "ok" | "warn" | "crit" | "none"; // 임계(없으면 none)
  freshness_sec: number; // 마지막 스크랩 경과(초)
  points: number[];   // 결정적 sparkline(끝=value)
  facets: Record<string, string>; // gpu|instance|job|device 등 label
}
export interface MetricCategory { key: string; label: string; rows: MetricRow[]; }
export interface ObjectMetricTree {
  generated_at: string; object_id: string; object_type: string;
  range: string; categories: MetricCategory[];
  facet_keys: string[]; source: string;
}
```

## 테스트 케이스 (normal / retry / failure / bad-input / env-missing)

mock 계약(`web/src/api/metricTree.test.ts`, installMockFetch 로 실제 라우터 통과):
- **normal(GPU)**: GpuDevice metric-tree 가 8 카테고리(Utilization…Per-process)를 갖고, 각 row 에 unit·type·status·points(≥2)·facets(gpu/instance/job) 존재.
- **normal(Node)**: Node metric-tree 가 CPU/Memory/Disk/Filesystem/Network/Load/Systemd 카테고리, row 에 unit·type 존재.
- **retry/deterministic**: 같은 id+range 반복 호출 시 카테고리 key·metric key·unit 동일(값 흔들림 허용하나 스키마·구조 고정).
- **bad-input(range)**: 알 수 없는 range → 기본 range 로 정규화, 200 + 스키마 유지.
- **failure/env-missing**: 미존재 id → 404(throw); 비-GPU/Node 객체(Model 등) → 404 또는 빈 categories(엔티티 앵커 아님).
- **facet**: GPU row.facets.gpu 가 UUID, node row.facets.instance 가 host:9100 형태.

컴포넌트(`web/src/components/MetricExplorer.test.tsx`, client mock):
- **카테고리 트리 렌더 + collapse/expand**: 카테고리 헤더 클릭 → 행 토글.
- **free-text 검색이 행을 필터**: 검색어 입력 시 매칭 행만.
- **facet 필터가 행을 필터**: facet 선택 시 해당 label 행만, 이후 부분일치 검색 결합.
- **각 행이 unit/type/status 노출**: 단위·타입 텍스트 존재.
- **empty(0 메트릭)**: categories 빈 → "메트릭이 없습니다" 안내.
- **loading**: fetch 지연 중 skeleton/로딩 텍스트.
- **error**: fetch reject → 에러 + 재시도 버튼.
- **windowing(many rows)**: threshold 초과 카테고리 펼침 시 VirtualRows 게이트(주입 viewport).
- **deterministic**: 동일 props 로 두 번 렌더 시 동일 행 집합.

## 제약 / 보안

mock-first·prod deps 0·Backend.AI 라이트+스틸블루 토큰·한글 주석·reduce-motion 안전·색+텍스트 병기(WCAG 1.4.1).
IMP-46 큐레이션 요약 default 유지. IMP-76 gpuHardware·IMP-81 스냅샷은 additive 로만 참조. 보안 라이트체크: mock/UI 만 —
사용자 입력(검색·facet)은 텍스트 필터로만 사용(코드 실행/HTML 삽입 없음), 프로세스명 등은 React 기본 escape 렌더.
