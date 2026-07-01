# IMP-55 — 토폴로지·노드·네트워크 mock 공통 팩토리

## 목적
토폴로지(노드+엣지 그래프)·노드 골든시그널·네트워크 링크 3세트를 추가하기 전에,
시계열 생성·시드·임계 로직 중복(IMP-7 임계 중복 전례)을 막을 재사용 가능한 mock 팩토리를 먼저 세운다.
데이터 계층만 — 화면(Topology/NodeMetrics/Network.tsx)은 후속 항목(IMP-45/46/49)이 이 위에서 만든다.

## 요구사항
- 기존 mock.ts 관례(mulberry32 `rng`, FNV-1a `hash`, `clamp`, seed 기반 결정성) 재사용.
- 단일 출처: 임계 상태 파생을 `statusFromThresholds` 한 곳으로(기존 GPU tempColor/utilCellColor/gpuStatus 와 통일된 규약: warn 경계 이상 → warn, crit 경계 이상 → crit).
- ZERO new deps. snake_case JSON(types.ts 관례).
- 재현성: 같은 seed → 같은 값(테스트 가능해야 하므로 순수 함수 + 신규 모듈로 추출).

## 출력 위치
- `web/src/api/mockFactory.ts` (신규) — 순수 팩토리 헬퍼. mock.ts 가 import.
- `web/src/api/types.ts` — TopologyGraph / NodeMetrics / NetworkLink 인터페이스.
- `web/src/api/client.ts` — fetchTopology / fetchNodeMetrics / fetchNetwork.
- `web/src/api/mock.ts` — 3 라우트 + 생성기(팩토리 사용).
- `web/src/api/mockFactory.test.ts` — Vitest.

## 함수 시그니처
```ts
// mockFactory.ts
export function rng(seed: number): () => number;      // mulberry32 (mock.ts 와 동일)
export function hash(s: string): number;              // FNV-1a
export function clamp(v: number, lo: number, hi: number): number;

export type ThresholdStatus = "ok" | "warn" | "crit";
// lower-is-bad 도 지원: warn<crit 이면 higher-is-worse, warn>crit 이면 lower-is-worse.
export function statusFromThresholds(value: number, warn: number, crit: number): ThresholdStatus;

export interface SeriesOpts { drift?: number; spike?: number; base?: number; amp?: number; min?: number; max?: number; }
export interface SeriesPoint { ts: string; value: number; }
// 결정적 시드 기반 시계열. now 기준 뒤로 points개, stepSec 간격.
export function seededSeries(seed: number, points: number, stepSec: number, opts?: SeriesOpts): SeriesPoint[];

// 그래프 빌더 — 서버/서비스/GPU 노드 + qps/errorRate 엣지.
export function buildTopology(seed: number): TopologyGraph;
```

## 타입 (types.ts)
- `TopologyNode { id; kind: "server"|"service"|"gpu"; status: "ok"|"warn"|"crit"; label; metrics? }`
- `TopologyEdge { from; to; qps?; error_rate? }`
- `TopologyGraph { generated_at; nodes: TopologyNode[]; edges: TopologyEdge[]; source }`
- `NodeMetrics` — host별 USE 세트(cpu/mem/disk util + load/swap/disk-io saturation + net err/rx/tx) 골든시그널 시계열.
- `NetworkLink` — 대역폭 rx/tx·지연 p50/p95/p99·loss·errs 시계열.

## 테스트 케이스
1. 시드 재현성: 같은 seed → seededSeries 값 배열 동일; 다른 seed → 다름.
2. seededSeries 길이 == points, value 는 [min,max] 범위 내.
3. statusFromThresholds 경계: higher-worse(warn<crit) — value<warn=ok, ==warn=warn, ==crit=crit, >crit=crit. lower-worse(warn>crit) 대칭.
4. buildTopology: 노드/엣지 수 결정적, 모든 엣지의 from/to 가 실재 노드 id, kind 3종 모두 존재, status 는 ThresholdStatus 값.

## 의존성
none (ZERO new deps).
