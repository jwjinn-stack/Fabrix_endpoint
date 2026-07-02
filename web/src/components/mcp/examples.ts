// IMP-86 — tool 별 예시 JSON-RPC 요청/응답 생성(레지스트리 inputSchema 단일 출처에서 결정적 파생).
//
// 서버는 read-only(POST /api/v1/mcp, JSON-RPC 2.0 tools/call). 여기서는 각 tool 의 inputSchema 를 보고
// 대표 인자(enum 이면 첫 값, required 우선)를 채운 **정적 예시** 요청/응답 문자열을 만든다 — 실제 호출은
// 하지 않는다(mutating 없음, 네트워크 없음). 코드블록에 그대로 표시된다.

import type { OntologyToolSpec } from "../../actions/ontologyTools";

// inputSchema 로 대표 arguments 를 만든다. enum → 첫 값, 그 외 → 타입/이름 기반 플레이스홀더.
function sampleArgs(spec: OntologyToolSpec): Record<string, unknown> {
  const props = spec.inputSchema.properties ?? {};
  const required = new Set(spec.inputSchema.required ?? []);
  const args: Record<string, unknown> = {};
  for (const [name, p] of Object.entries(props)) {
    // 필수는 항상, 선택은 enum 이 있을 때만(예시 밀도 낮춤 — Stripe 식 대표값).
    const include = required.has(name) || (p.enum && p.enum.length > 0);
    if (!include) continue;
    if (p.enum && p.enum.length > 0) {
      args[name] = p.enum[0];
    } else if (/id$/i.test(name)) {
      args[name] = "endpoint:ep-serving-a";
    } else if (name === "name") {
      args[name] = "vllm-serving";
    } else if (name === "namespace") {
      args[name] = "inference";
    } else {
      args[name] = "…";
    }
  }
  return args;
}

// 대표 응답(tool 계약을 설명하는 축약 스냅샷). read-only 조회 결과 형태를 보여준다.
function sampleResultText(spec: OntologyToolSpec): unknown {
  switch (spec.name) {
    case "query_objects":
      return { objects: [{ id: "endpoint:ep-serving-a", type: "Endpoint", title: "EP Serving A", status: "warn" }], count: 1 };
    case "traverse_links":
      return { links: [{ from: "endpoint:ep-serving-a", to: "model:llama-3", linkKind: "serves" }] };
    case "get_object":
      return { id: "endpoint:ep-serving-a", type: "Endpoint", title: "EP Serving A", status: "warn", props: { replicas: 2, ready: true } };
    case "get_object_metrics":
      return { id: "endpoint:ep-serving-a", range: "1h", metrics: { ttft_ms_p95: 312, itl_ms_p95: 24, qps: 18.4 } };
    case "list_pods":
      return { pods: [{ name: "vllm-serving-7c9", namespace: "inference", phase: "Running", restarts: 0, oomKilled: false }] };
    case "list_nodes":
      return { nodes: [{ name: "gpu-node-0", conditions: ["Ready"], schedulable: true }] };
    case "get_events":
      return { events: [{ reason: "BackOff", message: "Back-off restarting failed container", involvedObject: "pod/vllm-serving-7c9" }] };
    case "describe_deployment":
      return { name: "vllm-serving", desired: 2, updated: 2, available: 2, unavailable: 0, conditions: ["Available"] };
    default:
      return { ok: true };
  }
}

// MCP tools/call 요청/응답 표준 봉투(JSON-RPC 2.0). 결과는 content[].text(JSON 문자열) 규약.
export function exampleRequest(spec: OntologyToolSpec): string {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: spec.name, arguments: sampleArgs(spec) },
  };
  return JSON.stringify(body, null, 2);
}

export function exampleResponse(spec: OntologyToolSpec): string {
  const result = sampleResultText(spec);
  const body = {
    jsonrpc: "2.0",
    id: 1,
    result: {
      content: [{ type: "text", text: JSON.stringify(result) }],
      isError: false,
    },
  };
  return JSON.stringify(body, null, 2);
}
