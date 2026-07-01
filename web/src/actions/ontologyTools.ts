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

// 메트릭 시간 범위 — 백엔드 domain.ParseRange 와 동일 허용값(단일 출처 정합).
export const METRIC_RANGES = ["1h", "6h", "24h", "7d"] as const;

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
// 모듈 로드 시 1회 강제(개발 중 실수로 mutating tool 추가 시 즉시 터짐).
assertReadOnly();

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

// emit 페이로드 — 버전 + tool 배열(name 순 정렬). 아티팩트 파일과 byte 동일해야 한다.
export interface OntologyToolsArtifact {
  version: number;
  tools: OntologyToolSpec[];
}

export function buildOntologyToolsArtifact(): OntologyToolsArtifact {
  const tools = Object.values(ONTOLOGY_TOOL_REGISTRY)
    .slice()
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { version: 1, tools };
}

// 커밋 아티팩트와 동일한 문자열 표현(들여쓰기 2, 마지막 개행 포함, key 정렬).
export function emitOntologyToolSchemas(): string {
  const artifact = sortDeep(buildOntologyToolsArtifact());
  return JSON.stringify(artifact, null, 2) + "\n";
}
