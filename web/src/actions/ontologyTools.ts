// 온톨로지 read tool 레지스트리(IMP-73) — MCP tool 계약의 **단일 출처**.
//
// ACTION_REGISTRY(registry.ts)가 mutation(동사)의 단일 출처인 것과 대칭으로,
// 이 파일은 온톨로지·메트릭 **조회(read) tool** 의 단일 출처다. 프론트 agent(agent.ts)와
// 백엔드 MCP(go-sdk mcp_v2.go / 수기 mcp.go tools/list)가 이 하나의 계약에서 파생한다 —
// 어느 쪽도 스키마를 손으로 미러하지 않는다(IMP-7 anti-duplication; drift canary 로 강제).
//
// **핵심 안전장치(two-tier 게이팅)**: 이 레지스트리에는 read tool 만 담긴다. mutating 동사는
// 물리적으로 다른 파일(ACTION_REGISTRY)에만 존재하고, evaluateSubmission(capability+status) +
// <ActionForm> confirm 경로로만 실행된다 → 모델이 auto-callable tool 로 mutation 을 부를
// 구조적 경로가 없다. assertReadOnly() 가 이 불변식을 런타임/테스트로 못박는다.
//
// 스키마는 JSON Schema Draft(type:object + properties + required + additionalProperties:false).
// enum 은 ObjectType/LinkKind union 에서 파생(OBJECT_TYPES/LINK_KINDS 재사용) — 하드코딩 목록이
// 아니라 타입과 함께 움직인다. go-sdk 의 jsonschema-go 가 이 스키마를 그대로 먹고
// (additionalProperties:false = 여분 필드 거부, enum = 허용값 밖 거부) 핸들러 진입 전에 검증한다.

import { OBJECT_TYPES, LINK_KINDS } from "../api/ontologySchema";
import { GLOSSARY, type GlossaryTerm } from "../api/glossary";
import { WIDGET_META } from "../components/widgetMeta";
import type { Page } from "../components/Layout";

// ── 어시스트 컨텍스트 seam(IMP-106): route enum 은 Page union 에서 파생(하드코딩 금지) ──────────
// get_screen_context 의 route 인자 허용값. Page(Layout.tsx)와 어긋나면 타입이 잡는다.
// (Page 는 문자열 리터럴 union — 런타임 배열이 없으므로 여기 한 곳에서만 열거하고, 아래
//  assertRouteEnumCoversPages 가 Page 값이 이 배열에 다 담겼는지 컴파일 타임에 강제한다.)
export const SCREEN_ROUTES: Page[] = [
  "dashboard", "ontology", "usage", "guard", "traces", "sessions", "models", "model-import",
  "playground", "eval", "endpoints", "gpu", "nodes", "network", "topology", "investigate",
  "agent", "keys", "traffic", "settings", "credentials", "diagnostics", "metric-sources",
];
// 컴파일 타임 가드 — Page 에 값이 추가되면 이 배열이 빠짐없이 담아야 통과(exhaustiveness).
// SCREEN_ROUTES 를 Record 키로 재구성했을 때 Page 를 정확히 덮는지 타입 체크(누락/오탈자 방지).
type _RouteEnumCoversPages = Record<Page, true> extends Record<(typeof SCREEN_ROUTES)[number], true>
  ? Record<(typeof SCREEN_ROUTES)[number], true> extends Record<Page, true>
    ? true
    : ["SCREEN_ROUTES 에 Page 아닌 값이 있음"]
  : ["SCREEN_ROUTES 가 일부 Page 를 누락함"];
const _routeEnumCheck: _RouteEnumCoversPages = true;
void _routeEnumCheck;

// 메트릭 시간 범위 — 백엔드 domain.ParseRange 와 동일 허용값(단일 출처 정합).
export const METRIC_RANGES = ["1h", "6h", "24h", "7d"] as const;

// ── K8s 조회 enum(IMP-91) ────────────────────────────────────────────────────
// Kubernetes 표준 값. enum 밖 인자는 스키마가 거부(LLM hallucinated args 방어). 전부 read 축이라
// mutating 값(scale/restart/…)은 애초에 존재하지 않는다 — tool 자체가 조회(list/get/describe)만.
export const K8S_POD_PHASES = ["Pending", "Running", "Succeeded", "Failed", "Unknown"] as const;
export const K8S_NODE_CONDITIONS = ["Ready", "NotReady", "MemoryPressure", "DiskPressure", "PIDPressure"] as const;
export const K8S_EVENT_REASONS = ["OOMKilling", "BackOff", "CrashLoopBackOff", "FailedScheduling", "Unhealthy", "NodeNotReady", "Evicted"] as const;

// JSON Schema(우리가 쓰는 최소 부분집합) — go-sdk jsonschema-go 와 호환되는 필드만.
export interface JsonSchemaProp {
  type: "string";
  description: string;
  enum?: string[]; // 허용값(밖은 거부). 미지정 = 자유 문자열.
}
export interface JsonSchema {
  type: "object";
  properties: Record<string, JsonSchemaProp>;
  required?: string[];
  additionalProperties: false; // 봉투에 없는 여분 필드 거부(LLM hallucinated args 방어)
}

export interface OntologyToolSpec {
  name: string;              // MCP-canonical tool 명(snake_case; tools/list 에 그대로 노출)
  description: string;       // 모델용 설명(무엇을 접지하는지)
  inputSchema: JsonSchema;   // 입력 계약(프론트/백엔드 공유·drift 가드)
}

// ── 단일 출처 레지스트리 ────────────────────────────────────────────────────
// query_objects / traverse_links / get_object / get_object_metrics — 전부 read-only.
// enum 은 OBJECT_TYPES/LINK_KINDS/METRIC_RANGES 에서 파생(spread) → 타입과 어긋날 수 없다.
export const ONTOLOGY_TOOL_REGISTRY: Record<string, OntologyToolSpec> = {
  query_objects: {
    name: "query_objects",
    description: "온톨로지 객체(명사)를 type / 부분일치(filter)로 조회한다. 접지 대상 objectId 목록을 반환한다(조회 전용).",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "Object 타입(미지정=전체)", enum: [...OBJECT_TYPES] },
        filter: { type: "string", description: "title/id 부분일치 필터(미지정=전체)" },
      },
      additionalProperties: false,
    },
  },
  traverse_links: {
    name: "traverse_links",
    description: "한 객체의 이웃(관계)을 링크 그래프로 따라간다. linkType 으로 관계 종류를 좁힐 수 있다(조회 전용).",
    inputSchema: {
      type: "object",
      properties: {
        objectId: { type: "string", description: "기준 객체 id" },
        linkType: { type: "string", description: "관계 종류(미지정=모든 관계)", enum: [...LINK_KINDS] },
      },
      required: ["objectId"],
      additionalProperties: false,
    },
  },
  get_object: {
    name: "get_object",
    description: "단일 객체의 canonical 표현(type/title/status/props)을 id 로 조회한다(조회 전용).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "객체 id" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  get_object_metrics: {
    name: "get_object_metrics",
    description: "한 객체의 시계열/현재 메트릭 요약을 조회한다(GPU util·메모리·엔드포인트 지연 등). range 로 기간을 정한다(조회 전용).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "객체 id" },
        range: { type: "string", description: "시간 범위(기본 1h)", enum: [...METRIC_RANGES] },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
};

// ── K8s read tool 레지스트리(IMP-91) — 병렬 단일 출처, 온톨로지와 동일하게 소비 ──────────
// kagent/k8sgpt/Datadog K8s 식 자연어 클러스터 진단의 read 축. Dynamo/vLLM 워크로드가 K8s 위에 돌기에
// GPU/Node 온톨로지 이상 ↔ 파드 재시작·노드 NotReady·OOMKilled 이벤트를 상관시켜 답한다.
//
// **핵심 안전(two-tier)**: 여기에는 조회(list/get/describe)만 담긴다. mutating k8s verb(scale/restart/
// drain/cordon/delete/apply)는 물리적으로 없다 → 에이전트가 auto-callable tool 로 클러스터를 변경할
// 구조적 경로가 없다. assertReadOnly() 가 이 레지스트리에도 걸려 불변식을 못박는다(아래 호출부).
//
// **정직성(direction 8)**: mock-first. 실연동은 official kubernetes-mcp-server SPIKE(IMP-79 K8s 백본과 짝).
// 이 계약(name/args/enum)은 그대로 두고 transport 만 스왑하면 실 kube-mcp 로 교체된다.
export const K8S_TOOL_REGISTRY: Record<string, OntologyToolSpec> = {
  list_pods: {
    name: "list_pods",
    description: "Kubernetes 파드를 조회한다(재시작 카운트·OOMKilled·phase). objectId 로 온톨로지 객체(Endpoint/Model/Node)와 상관시킬 수 있다(조회 전용, mock-first).",
    inputSchema: {
      type: "object",
      properties: {
        namespace: { type: "string", description: "네임스페이스(미지정=전체)" },
        phase: { type: "string", description: "파드 phase 로 필터(미지정=전체)", enum: [...K8S_POD_PHASES] },
        objectId: { type: "string", description: "상관시킬 온톨로지 객체 id(미지정=전체)" },
      },
      additionalProperties: false,
    },
  },
  list_nodes: {
    name: "list_nodes",
    description: "Kubernetes 노드를 조회한다(condition·NotReady 사유). NotReady 노드를 찾는 데 쓴다(조회 전용, mock-first).",
    inputSchema: {
      type: "object",
      properties: {
        condition: { type: "string", description: "노드 condition 으로 필터(미지정=전체)", enum: [...K8S_NODE_CONDITIONS] },
      },
      additionalProperties: false,
    },
  },
  get_events: {
    name: "get_events",
    description: "최근 Kubernetes 이벤트를 조회한다(reason·message·involvedObject). OOMKilling/BackOff 등 파드 재시작 원인을 접지한다(조회 전용, mock-first).",
    inputSchema: {
      type: "object",
      properties: {
        objectId: { type: "string", description: "상관시킬 온톨로지 객체 id(미지정=전체)" },
        reason: { type: "string", description: "이벤트 reason 으로 필터(미지정=전체)", enum: [...K8S_EVENT_REASONS] },
      },
      additionalProperties: false,
    },
  },
  describe_deployment: {
    name: "describe_deployment",
    description: "Kubernetes 배포(Deployment)의 rollout 상태(desired/updated/available/unavailable·조건)를 조회한다(조회 전용, mock-first).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "배포 이름(미지정=전체)" },
        objectId: { type: "string", description: "상관시킬 온톨로지 객체 id(미지정=전체)" },
      },
      additionalProperties: false,
    },
  },

  // ── 복합(coarse-grained) 진단 tool(IMP-98) — 하이브리드: 위 원자 tool 은 드릴다운용으로 유지 ────
  // 2025 MCP "workflow/coarse-grained tool" 패턴: 흔한 유스케이스(인시던트 원인 컨텍스트)를 한 tool 로
  // 캡슐화해 다중 round-trip(list_pods→get_events→describe_deployment)과 중간 스키마 반복 직렬화를 없앤다.
  // **단일 출처**: 아래 두 tool 은 IMP-99 seam(buildIncidentEvidence) 하나만 소비한다 → UI(ObjectView/COP)와
  // MCP 가 동일 shape(신호→추정원인→영향 + 인용 refs)를 반환. 새 파생 규칙을 발명하지 않는다.
  // **read-only**: 조회 동사(get_*)라 assertReadOnly() 자동 커버. mutating 부작용 없음(순수 seam 소비).
  get_incident_context: {
    name: "get_incident_context",
    description: "read-only diagnostic bundle, no mutation. 한 온톨로지 객체(Endpoint/Model/Node)의 인시던트 원인 컨텍스트를 한 호출로 반환한다 — 상관 파드·이벤트·배포 rollout·큐 신호 + 추정 근본원인 요약 + 근거 인용(objectId/podRef). 원자 tool(list_pods/get_events/describe_deployment)을 여러 번 부를 필요 없이 여기서 번들로 받는다(mock-first).",
    inputSchema: {
      type: "object",
      properties: {
        objectId: { type: "string", description: "진단 대상 온톨로지 객체 id(필수)" },
      },
      required: ["objectId"],
      additionalProperties: false,
    },
  },
  get_pod_diagnostics: {
    name: "get_pod_diagnostics",
    description: "read-only diagnostic bundle, no mutation. 한 파드(pod/<name> 또는 <name>)의 진단 번들을 반환한다 — waiting reason·재시작 횟수·OOMKilled·연관 이벤트 + 상관된 온톨로지 객체의 원인 컨텍스트(동일 seam). 특정 파드가 왜 재시작/OOM 했는지 한 호출로 받는다(mock-first).",
    inputSchema: {
      type: "object",
      properties: {
        pod: { type: "string", description: "파드 이름(pod/<name> 접두 허용, 필수)" },
      },
      required: ["pod"],
      additionalProperties: false,
    },
  },
};

// ── 어시스트 컨텍스트 TOOL 레지스트리(IMP-106) — get_screen_context 하나(동적 per-turn 상태) ──────
// MCP primitive 분할: glossary/widget 은 정적·named → RESOURCE(아래 ASSIST_RESOURCE_TEMPLATES).
// get_screen_context 는 라우트/열린 객체/facet/선택 영역 + 그 화면에 마운트된 widget id 로,
// 매 턴 바뀌는 동적 상태라 정당한 read-only TOOL(파라미터화 조회). 조회 동사(query) — mutating 아님.
// route enum 은 SCREEN_ROUTES(Page 파생)에서 spread → 화면 목록과 어긋날 수 없다.
export const ASSIST_TOOL_REGISTRY: Record<string, OntologyToolSpec> = {
  get_screen_context: {
    name: "get_screen_context",
    description: "read-only, no mutation. 현재 화면(route)에 마운트된 위젯 id·메타와 동적 컨텍스트(열린 객체 objectId·facet·선택 영역 selection)를 한 호출로 반환한다 — 어시스트가 '지금 이 화면에서' 답을 접지할 근거. 앱 전체 덤프가 아니라 그 화면에 실제 마운트된 위젯만 준다(정보폭탄 금지).",
    inputSchema: {
      type: "object",
      properties: {
        route: { type: "string", description: "현재 라우트(화면)", enum: [...SCREEN_ROUTES] },
        objectId: { type: "string", description: "열린 온톨로지 객체 id(선택)" },
        facet: { type: "string", description: "활성 facet/서브뷰(선택)" },
        selection: { type: "string", description: "선택 영역/위젯 id(선택)" },
      },
      required: ["route"],
      additionalProperties: false,
    },
  },
};

// ── 어시스트 RESOURCE 템플릿(IMP-106) — glossary://{term}·widget://{id}, read-only·addressable ──────
// MCP resource template(uriTemplate). tool 이 아니라 리소스라 tool-call 비용 0 + pinnable.
// **injection surface**: name/description 은 정적 선언 문자열만(사용자·객체 내용 보간 금지, prompt-injection 방어).
export interface AssistResourceTemplate {
  uriTemplate: string;   // 예: "glossary://{term}"
  name: string;          // 사람용 라벨(정적)
  description: string;   // 모델용 설명(정적 — 보간 금지)
  mimeType: string;
}
export const ASSIST_RESOURCE_TEMPLATES: AssistResourceTemplate[] = [
  {
    uriTemplate: "glossary://{term}",
    name: "용어 사전(glossary)",
    description: "관측 도메인 용어의 정의(short)·왜 중요한가(why)·분류·연관 용어를 term(key 또는 alias)으로 조회한다(read-only, 정적 참조데이터). 미지 용어는 지어내지 않는다.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "widget://{id}",
    name: "위젯 메타(widget)",
    description: "대시보드 위젯/영역이 무엇을 보여주는지(whatItShows)·좋음나쁨 판정 근거(임계 참조)·연관 용어를 위젯 id 로 조회한다(read-only, 정적 참조데이터). 선언된 메타 없으면 지어내지 않는다.",
    mimeType: "application/json",
  },
];

// resolved 콘텐츠(emit 시 아티팩트에 실어 Go 도 동일 단일 출처에서 read 를 서빙 — 데이터 중복 없음).
// 순수 조회만 — GLOSSARY/WIDGET_META 를 그대로 담고, 어떤 사용자 입력도 보간하지 않는다.
export interface AssistResourceContents {
  glossary: Record<string, GlossaryTerm>; // key → term(alias 해석은 resolver 가 담당)
  widgets: Record<string, { title: string; whatItShows: string; relatedTerms: string[] }>;
}
export function buildAssistResourceContents(): AssistResourceContents {
  const widgets: AssistResourceContents["widgets"] = {};
  for (const [id, meta] of Object.entries(WIDGET_META)) {
    // 숫자·라이브 판정은 담지 않는다(단일 출처: verdict 는 답변 시점 deriveVerdict 파생). 정적 메타만.
    widgets[id] = { title: meta.title, whatItShows: meta.whatItShows, relatedTerms: [...meta.relatedTerms] };
  }
  return { glossary: GLOSSARY, widgets };
}

// ── read-only 불변식 가드(two-tier 안전) ────────────────────────────────────
// mutating 성격의 이름이 이 레지스트리에 들어오면 즉시 실패(mutation 은 ACTION_REGISTRY 에만).
// tools/list 를 이 레지스트리에서 파생하므로, 여기 가드가 곧 "auto-callable mutation 없음" 보장.
const MUTATING_VERBS = ["create", "update", "delete", "remove", "set", "write", "patch", "put", "post", "scale", "restart", "drain", "cordon", "resolve", "ack", "snooze", "apply", "invoke", "execute", "run", "start", "stop", "kill"];

export function assertReadOnly(reg: Record<string, OntologyToolSpec> = ONTOLOGY_TOOL_REGISTRY): void {
  for (const name of Object.keys(reg)) {
    const lower = name.toLowerCase();
    for (const verb of MUTATING_VERBS) {
      if (lower.includes(verb)) {
        throw new Error(`ONTOLOGY_TOOL_REGISTRY 는 read-only 여야 합니다 — mutating 성격 tool 발견: ${name} (mutation 은 ACTION_REGISTRY 에만 두세요)`);
      }
    }
  }
}
// 모듈 로드 시 1회 강제(개발 중 실수로 mutating tool 추가 시 즉시 터짐). 온톨로지+K8s+어시스트 세 레지스트리 모두.
assertReadOnly(ONTOLOGY_TOOL_REGISTRY);
assertReadOnly(K8S_TOOL_REGISTRY);
assertReadOnly(ASSIST_TOOL_REGISTRY); // IMP-106 — get_screen_context(query verb) read-only 강제.

// ── 계약 아티팩트 emit(TS→Go 단일 출처) ─────────────────────────────────────
// 레지스트리에서 committed .json 아티팩트(ontology-tools.schema.json)를 결정적으로 만든다.
// Go 가 이 파일을 go:embed 로 로드해 그대로 AddTool 에 먹인다 → 수기 미러 금지.
// drift canary(ontologyTools.emit.test.ts + go mcp_contract_test.go)가 양측 동일을 보장.

// 결정적 직렬화 — key 를 사전순으로 정렬해 재현 가능한(byte 안정) JSON 을 만든다.
function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortDeep((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

// emit 페이로드 — 버전 + tool 배열(name 순 정렬) + 어시스트 resource template/콘텐츠(IMP-106).
// 아티팩트 파일과 byte 동일해야 한다.
export interface OntologyToolsArtifact {
  version: number;
  tools: OntologyToolSpec[];
  // IMP-106 — 어시스트 컨텍스트 seam(RESOURCE 축). 단일 아티팩트로 emit 해 3-way drift canary 가 함께 강제.
  resourceTemplates: AssistResourceTemplate[];
  resourceContents: AssistResourceContents;
}

// 아티팩트는 온톨로지 read tool + K8s read tool(IMP-91) + 어시스트 TOOL(IMP-106 get_screen_context)을
// 합쳐 name 순으로 담고, 어시스트 RESOURCE 템플릿·콘텐츠를 함께 실는다 — 전부 read-only 계약의 단일
// 출처라 하나의 아티팩트로 emit 하면 3-way drift canary(web↔아티팩트↔Go)가 함께 강제한다.
export function buildOntologyToolsArtifact(): OntologyToolsArtifact {
  const tools = [
    ...Object.values(ONTOLOGY_TOOL_REGISTRY),
    ...Object.values(K8S_TOOL_REGISTRY),
    ...Object.values(ASSIST_TOOL_REGISTRY),
  ]
    .slice()
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {
    version: 1,
    tools,
    resourceTemplates: ASSIST_RESOURCE_TEMPLATES,
    resourceContents: buildAssistResourceContents(),
  };
}

// 커밋 아티팩트와 동일한 문자열 표현(들여쓰기 2, 마지막 개행 포함, key 정렬).
export function emitOntologyToolSchemas(): string {
  const artifact = sortDeep(buildOntologyToolsArtifact());
  return JSON.stringify(artifact, null, 2) + "\n";
}
