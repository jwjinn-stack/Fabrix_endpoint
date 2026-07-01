# IMP-50 — 서비스 의존성 맵 + 골든시그널 인프라 뷰 (LLM-aware) — correlation이 moat

- **Type**: compete (sev=medium, effort=L)
- **Branch**: feature/evolve-cycle3-topology
- **의존성**: none (ZERO new deps, mock-first, 기존 화면·onNavigate·SlidePanel·mockFactory 재사용)

## 목적
LLM 관측(trace/guard/eval)과 인프라 관측(토폴로지·호스트 골든시그널·네트워크, 이번 사이클)을
**한 그래프에서 correlate**한다 — 경쟁사(Datadog/Kiali/Grafana)는 service edge를 host/GPU
saturation과 native 융합하지 않음. 차별화는 "LLM이 느린 게 앱/GPU/네트워크인가?"를 한 콘솔에서
답하는 correlation 경로 자체.

**새 대형 화면·새 인프라 데이터 모델 금지.** 기존 화면들을 correlation·드릴다운으로 잇는 얇은 레이어.
**endpoint/host ID를 join key로 재사용**(별도 모델 발명 금지).

## 요구사항
1. **토폴로지 노드 → 기존 화면 드릴다운(kind별)**: TopologyView `onSelect`/SlidePanel 에서 노드 kind별
   자연 네비게이션 — `service` → 해당 endpoint 의 Traces(모델 필터 시드), `gpu` → Gpu 화면, `server` → NodeMetrics(호스트).
   `onNavigate(page, params)` 로 필터 컨텍스트 운반.
2. **trace ↔ infra 상관 요약 인라인(mock)**: 트레이스 상세(SlidePanel)에 "이 요청 시각의 GPU/호스트 pressure"
   한 줄 요약 — endpoint 를 join key 로 토폴로지 service 노드 → 그 host/GPU saturation(mock)을 표면화.
   inference↔infra 상관을 한 줄로. 깊게 만들 필요 없음(상관 엣지가 존재함을 시연).
3. **골든시그널 표준 4종**(latency/traffic/errors/saturation): bespoke 메트릭 발명 금지 —
   토폴로지 노드 metrics(qps/error_rate/util/cpu)를 golden-signal micro-summary 로 연결(이미 IMP-46/49 커버).
4. **LLM-aware 포지셔닝 문구**: Topology 화면 상단에 "LLM-aware infrastructure observability —
   LLM이 느린 게 앱/GPU/네트워크인가?를 한 콘솔에서" 한 줄 + 짧은 docs.

## 함수 시그니처 (순수·seam, web/src/api/correlation.ts)
```ts
// 노드 kind → 기존 화면 네비게이션 타깃(순수). null = 드릴다운 대상 없음.
export interface NavTarget { page: Page; params?: NavParams; label: string }
export function nodeNavTarget(node: TopologyNode): NavTarget | null;

// endpoint(=service 노드 id) 를 join key 로 토폴로지에서 host/GPU saturation 을 상관.
// trace 상세 인라인 요약용. graph 없으면 null(graceful).
export interface InfraCorrelation {
  host: string;              // 해당 endpoint 를 서빙하는 host
  hostStatus: NodeStatus;    // host 노드 status
  worstGpuStatus: NodeStatus;// host 의 GPU 중 최악
  saturation: number;        // 대표 saturation 지표(0..1, host cpu_util 근사)
  note: string;              // 한 줄 요약 텍스트(이스케이프 렌더)
  pressure: boolean;         // host/gpu 중 하나라도 warn/crit → 인프라 압박
}
export function correlateInfra(endpoint: string, graph: TopologyGraph | null): InfraCorrelation | null;
```

## 테스트 케이스 (RTL + 순수함수)
- `nodeNavTarget`: service → {page:"traces", params.model 세팅}, gpu → {page:"gpu"}, server → {page:"nodes"}.
- Topology SlidePanel: 노드 선택 → "관련 화면 열기" 버튼 클릭 → onNavigate 가 kind별 올바른 page/params 로 호출.
- `correlateInfra`: 알려진 endpoint(service 노드) → host/GPU status·note 반환, pressure 판정. 미지 endpoint → null.
- Trace 상세: 상관 요약 한 줄(호스트/GPU pressure) 렌더 + "인프라 상세로" 드릴다운 버튼.
- 포지셔닝: Topology 상단 "LLM-aware" 문구 렌더.

## 출력 위치
- web/src/api/correlation.ts (신규, 순수 모듈)
- web/src/api/correlation.test.ts (신규, 순수 단위)
- web/src/pages/Topology.tsx (onNavigate prop + SlidePanel 드릴다운 버튼 + 포지셔닝 문구)
- web/src/pages/Topology.nav.test.tsx (신규, RTL)
- web/src/pages/Traces.tsx (trace 상세 인라인 infra 상관 요약)
- web/src/App.tsx (Topology 에 onNavigate 전달)
- web/src/router.ts (NavParams 에 host 필드 추가 — host join key)
- docs 짧게(README 또는 docs/)

## 비회귀
IMP-45/46/49 비회귀. ZERO new deps. observe/manage cap 게이트 유지(읽기전용도 네비게이션은 허용).
hand-rolled(zero-dep), 라이트 스틸블루, 네온 금지.
