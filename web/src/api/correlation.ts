// IMP-50 — LLM-aware 인프라 관측: correlation moat (순수 seam).
//
// "LLM이 느린 게 앱/GPU/네트워크인가?"를 한 콘솔에서 답하기 위해, 이미 제품이 추적하는
// 엔티티(endpoint/host)를 join key 로 재사용해 inference(trace) ↔ infra(topology saturation)를 잇는다.
// 새 인프라 데이터 모델을 발명하지 않는다 — 오직 기존 TopologyGraph·기존 화면(Traces/Gpu/NodeMetrics)만 연결.
//
// - 의존성 0개(프로젝트 ethos). 순수 함수만 두어 join·상관 로직을 단위 테스트로 가드한다.
// - 노드 kind → 기존 화면 네비게이션 매핑(드릴다운) + endpoint→infra saturation 상관(trace 인라인).

import type { NavParams } from "../router";
import type { Page } from "../components/Layout";
import type { NodeStatus, TopologyGraph, TopologyNode } from "./types";
import { worstStatus } from "./mockFactory";

// ───────────────────────── 노드 kind → 기존 화면 드릴다운 ─────────────────────────
// 토폴로지 노드를 클릭하면 kind 에 맞는 기존 화면으로 필터 컨텍스트를 실어 이동한다.
// 새 화면을 만들지 않고 기존 Traces/Gpu/NodeMetrics 로 자연 네비게이션.

export interface NavTarget {
  page: Page;
  params?: NavParams;
  label: string; // 드릴다운 버튼 문구(이스케이프 렌더)
}

// service 노드 id(=endpoint 이름) → Traces 모델 필터 시드값.
// mock.ts ENDPOINTS(name → model) 와 정합. 미지 endpoint 는 endpoint 이름을 그대로 model 로 시드(graceful).
const ENDPOINT_TO_MODEL: Record<string, string> = {
  "gemma-3-27b-it": "gemma-3-27b-it",
  "qwen3-32b-router": "qwen3-32b",
  "llama-33-70b": "llama-3.3-70b-instruct",
  "bge-m3-embed": "bge-m3",
  "qwen25-vl-7b": "qwen2.5-vl-7b",
};

// gpu 노드 id 는 `${host}/gpu${n}` 형식(buildTopology) → host 접두어 추출.
export function hostOfGpuNode(gpuId: string): string {
  const slash = gpuId.indexOf("/");
  return slash > 0 ? gpuId.slice(0, slash) : gpuId;
}

export function modelForEndpoint(endpoint: string): string {
  return ENDPOINT_TO_MODEL[endpoint] ?? endpoint;
}

// nodeNavTarget — 노드 kind별 기존 화면 드릴다운 타깃(순수). null = 대상 없음.
//   service → Traces(모델 필터 시드), gpu → Gpu 화면(host), server → NodeMetrics(host).
export function nodeNavTarget(node: TopologyNode): NavTarget | null {
  switch (node.kind) {
    case "service":
      return {
        page: "traces",
        params: { model: modelForEndpoint(node.id) },
        label: "이 서비스의 트레이스 보기",
      };
    case "gpu":
      return {
        page: "gpu",
        params: { host: hostOfGpuNode(node.id) },
        label: "GPU 상세 보기",
      };
    case "server":
      return {
        page: "nodes",
        params: { host: node.id },
        label: "노드 메트릭 보기",
      };
    default:
      return null;
  }
}

// ───────────────────────── trace ↔ infra saturation 상관 ─────────────────────────
// endpoint(=service 노드 id) 를 join key 로 토폴로지에서 그 endpoint 를 서빙하는 host/GPU 의
// saturation 을 찾아, 트레이스 상세에 "이 시각 인프라 pressure" 한 줄로 표면화한다(mock-first).

export interface InfraCorrelation {
  endpoint: string;
  host: string;
  hostStatus: NodeStatus;
  worstGpuStatus: NodeStatus;
  saturation: number; // 0..1 대표 saturation(host cpu_util 근사) — 없으면 0
  pressure: boolean; // host/gpu 중 warn/crit 하나라도 → 인프라 압박
  note: string; // 한 줄 요약(이스케이프 렌더)
}

const STATUS_KO: Record<NodeStatus, string> = { ok: "정상", warn: "주의", crit: "위험" };

// correlateInfra — endpoint → host/GPU saturation 상관. graph 없거나 미매칭이면 null(graceful).
export function correlateInfra(endpoint: string, graph: TopologyGraph | null): InfraCorrelation | null {
  if (!graph || !endpoint) return null;
  const svc = graph.nodes.find((n) => n.kind === "service" && n.id === endpoint);
  if (!svc) return null;

  // service → server(host) 배치 엣지. buildTopology: {from: svc.id, to: svc.host}.
  const hostEdge = graph.edges.find((e) => e.from === endpoint && isServer(graph, e.to));
  const host = hostEdge?.to;
  if (!host) return null;
  const hostNode = graph.nodes.find((n) => n.id === host && n.kind === "server");
  const hostStatus: NodeStatus = hostNode?.status ?? "ok";
  const saturation = typeof hostNode?.metrics?.cpu_util === "number" ? hostNode.metrics.cpu_util : 0;

  // host → gpu 디바이스 엣지들의 최악 상태.
  const gpuIds = graph.edges.filter((e) => e.from === host).map((e) => e.to);
  const gpuStatuses = graph.nodes
    .filter((n) => n.kind === "gpu" && gpuIds.includes(n.id))
    .map((n) => n.status);
  const worstGpuStatus: NodeStatus = gpuStatuses.length ? worstStatus(gpuStatuses) : "ok";

  const pressure = hostStatus !== "ok" || worstGpuStatus !== "ok";
  const note = pressure
    ? `이 요청 시각 인프라 압박 감지 — 호스트 ${host} ${STATUS_KO[hostStatus]}, GPU ${STATUS_KO[worstGpuStatus]} (포화 ${Math.round(saturation * 100)}%). 지연 원인이 GPU/호스트일 수 있습니다.`
    : `이 요청 시각 인프라 정상 — 호스트 ${host} 정상, GPU 정상 (포화 ${Math.round(saturation * 100)}%). 지연은 앱/모델 단에서 발생했을 가능성이 큽니다.`;

  return { endpoint, host, hostStatus, worstGpuStatus, saturation, pressure, note };
}

function isServer(graph: TopologyGraph, id: string): boolean {
  return graph.nodes.some((n) => n.id === id && n.kind === "server");
}
