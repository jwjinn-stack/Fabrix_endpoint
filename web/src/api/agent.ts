// IMP-60 — 온톨로지 접지 AI Agent 루프 (순수 seam).
//
// "이 느린 엔드포인트 원인 찾아줘" → 로컬 모델이 온톨로지를 tool 로 조회(read-only)하고
// 근본원인 후보 + 실행 가능 Action 을 제안한다(docs §3·§5.4, AWS grounded-agent Pattern 5).
// 새 데이터 모델을 발명하지 않는다 — 기존 온톨로지(IMP-56) + buildRootCausePath(IMP-58) 만 grounding 으로 쓴다.
//
// - 의존성 0개(프로젝트 ethos). 순수 함수만 두어 tool 실행·ReAct 순서·grounding-empty fallback 을 단위 테스트로 가드.
// - **핵심 안전장치(two-tier 게이팅)**: 이 파일의 tool 은 조회 전용이다. mutating tool 은 존재하지
//   않는다 → 모델이 confirm 없이 mutation 을 부를 구조적 경로가 없다. mutation 은 오직
//   <ActionForm>(IMP-59) + evaluateSubmission(capability+status) 게이팅으로만 실행된다.
// - VITE_MOCK=off 는 transport 만 스왑(client.runAgent 가 그대로 실백엔드로). tool 스키마는 fork 하지 않는다.
//
// IMP-73 — tool "시그니처"의 단일 출처는 이 파일이 아니라 ONTOLOGY_TOOL_REGISTRY(actions/ontologyTools.ts)다.
// 예전엔 여기 read tool 을 "실제 MCP tool 과 동일한 시그니처"라 주석만 했으나 강제되지 않아 drift 위험이었다.
// 이제 아래 AGENT_TOOL_CONTRACT 가 agent 내부명(camelCase)을 레지스트리의 MCP-canonical tool(snake_case)에
// 명시 바인딩하고, 모듈 로드 시 그 tool 이 레지스트리에 실재함을 assert 한다 → 백엔드 MCP 와 계약이 하나로 묶인다.

import type {
  AgentAuditEntry, AgentInsightRun, AgentRun, AgentStep, AgentToolName, AgentToolResult,
  ClusterInsight, InsightKind, ObjectType, OntologyLink, OntologyObject, RcaCandidate,
} from "./types";
import { buildRootCausePath, defaultEntry, pickEntryCandidates } from "./investigate";
import { ONTOLOGY_TOOL_REGISTRY } from "../actions/ontologyTools";

// AGENT_TOOL_CONTRACT — ReAct 루프가 자동 실행하는 read tool(agent 내부명)을 MCP-canonical tool 명에 바인딩.
// getIncidents 는 query_objects{type:Incident} 의 편의 별칭이라 같은 계약(query_objects)에 매핑된다.
// 이 상수 하나로 "agent tool == 레지스트리 tool" 이 코드로 강제된다(주석 아님).
export const AGENT_TOOL_CONTRACT: Record<AgentToolName, string> = {
  queryObjects: "query_objects",
  traverseLinks: "traverse_links",
  getIncidents: "query_objects", // Incident 타입 필터의 편의 별칭
};

// 모듈 로드 시 1회 — agent 가 참조하는 MCP tool 이 레지스트리에 실재하는지 강제(계약 drift 즉시 감지).
for (const [agentName, mcpName] of Object.entries(AGENT_TOOL_CONTRACT)) {
  if (!ONTOLOGY_TOOL_REGISTRY[mcpName]) {
    throw new Error(`agent tool ${agentName} 이 참조하는 MCP tool ${mcpName} 이 ONTOLOGY_TOOL_REGISTRY 에 없습니다(계약 불일치)`);
  }
}

// ── read-only tool 구현 ─────────────────────────────────────────────────────
// 입력/출력 계약(시그니처)은 ONTOLOGY_TOOL_REGISTRY 단일 출처를 따른다(위 AGENT_TOOL_CONTRACT 로 바인딩).
// 아래 함수는 그 계약의 mock 실행부일 뿐 — 전부 온톨로지 스냅샷 위에서 조회만 한다.
//
// tool: queryObjects(type?, filter?) = MCP query_objects — 명사(Object)를 type/부분일치로 추린다.
export function toolQueryObjects(
  objects: OntologyObject[],
  args: { type?: string; filter?: string },
): AgentToolResult {
  let rows = objects;
  if (args.type) rows = rows.filter((o) => o.type === args.type);
  const f = (args.filter ?? "").trim().toLowerCase();
  if (f) rows = rows.filter((o) => o.title.toLowerCase().includes(f) || o.id.toLowerCase().includes(f));
  const ids = rows.map((o) => o.id);
  return {
    objectIds: ids,
    summary: ids.length ? `${args.type ?? "객체"} ${ids.length}건 조회` : "일치하는 객체 없음",
    found: ids.length > 0,
  };
}

// tool: traverseLinks(objectId, linkType?) — 한 객체의 이웃(관계)을 따라간다.
export function toolTraverseLinks(
  objects: OntologyObject[],
  links: OntologyLink[],
  args: { objectId: string; linkType?: string },
): AgentToolResult {
  const has = objects.some((o) => o.id === args.objectId);
  if (!has) return { objectIds: [], summary: `대상 객체 없음: ${args.objectId}`, found: false };
  let ls = links.filter((l) => l.from === args.objectId || l.to === args.objectId);
  if (args.linkType) ls = ls.filter((l) => l.linkKind === args.linkType);
  // 이웃 id 집합(자기 자신 제외, 결정적 정렬).
  const neigh = Array.from(new Set(ls.map((l) => (l.from === args.objectId ? l.to : l.from)))).sort();
  return {
    objectIds: neigh,
    summary: neigh.length ? `${args.objectId} 의 이웃 ${neigh.length}건` : "인접 객체 없음",
    found: neigh.length > 0,
  };
}

// tool: getIncidents() — 발생 인시던트(Incident Object)를 모은다.
export function toolGetIncidents(objects: OntologyObject[]): AgentToolResult {
  const ids = objects.filter((o) => o.type === "Incident").map((o) => o.id);
  return {
    objectIds: ids,
    summary: ids.length ? `인시던트 ${ids.length}건` : "발생 인시던트 없음",
    found: ids.length > 0,
  };
}

// objectType → 제안 verb(레지스트리 verb 이름). "제안"일 뿐 — 실행은 ActionForm confirm + capability 게이팅.
const SUGGESTED_ACTION: Partial<Record<ObjectType, string>> = {
  Model: "scaleReplicas",
  GpuDevice: "drainGpu",
  Node: "cordonNode",
};

// grounding 이 전무할 때의 정적 runbook(모델이 지어내지 않는다 — 사람이 미리 정한 절차).
export const FALLBACK_RUNBOOK: string[] = [
  "온톨로지에서 접지할 대상(문제 Endpoint/Incident)을 찾지 못했습니다.",
  "1) 연동 상태 화면에서 메트릭·트레이스 소스 연결을 확인하세요.",
  "2) 엔드포인트 목록에서 NotReady/이상 상태 대상이 있는지 점검하세요.",
  "3) 대상을 확인한 뒤 근본원인 추적(COP) 화면에서 진입점을 지정해 다시 시도하세요.",
];

// ── ReAct 에이전트 루프(결정적) ──────────────────────────────────────────────
// intent(자연어) + entity(옵션 진입점)를 받아, 온톨로지 위에서 read tool 을 순서대로 실행하고
// buildRootCausePath 로 근본원인 후보를 confidence 순위로 만든다. grounding 없으면 runbook fallback.
//   objects/links: 온톨로지 스냅샷(mock buildOntology 또는 실백엔드에서 받은 것).
//   nowIso: audit 타임스탬프 소스(테스트 결정성 위해 주입 가능).
export function runAgentLoop(
  objects: OntologyObject[],
  links: OntologyLink[],
  opts: { intent?: string; entity?: string; traceId: string; nowIso?: string },
): AgentRun {
  const ts = opts.nowIso ?? new Date().toISOString();
  const intent = (opts.intent ?? "이 느린 엔드포인트의 근본원인을 찾아줘").trim();
  const traceId = opts.traceId;

  const steps: AgentStep[] = [];
  const audit: AgentAuditEntry[] = [];
  const rec = (kind: AgentAuditEntry["kind"], detail: string) => audit.push({ traceId, kind, detail, ts });
  const reason = (text: string) => { steps.push({ kind: "reasoning", text }); rec("reasoning", text); };
  const runTool = (tool: AgentToolName, args: Record<string, string>, result: AgentToolResult) => {
    steps.push({ kind: "tool", call: { tool, args }, result });
    rec("tool", `${tool}(${JSON.stringify(args)}) → ${result.objectIds.length}건`);
    return result;
  };

  // prompt 는 마스킹된 의도만 audit(원문 시크릿 로깅 금지).
  rec("prompt", `intent: ${intent.slice(0, 120)}`);

  // 진입점 확정 — URL/인자 entity 우선, 없으면 가장 아픈 후보(defaultEntry). 데이터 없으면 null.
  const entryId = opts.entity && objects.some((o) => o.id === opts.entity)
    ? opts.entity
    : defaultEntry(objects);

  // 1) reasoning — 접지 대상 탐색.
  reason("가장 먼저, 접지할 문제 대상(진입점)을 온톨로지에서 찾는다.");

  // 2) tool getIncidents — 발생 인시던트로 상황 파악(자동 실행).
  runTool("getIncidents", {}, toolGetIncidents(objects));

  // grounding 없음(진입점 미해결) → hallucination 금지: 정적 runbook fallback.
  if (!entryId) {
    reason("접지 가능한 진입점이 없다. 임의로 원인을 지어내지 않고 정적 runbook 으로 안내한다.");
    return {
      traceId, intent, steps, candidates: [], grounded: false,
      fallbackRunbook: FALLBACK_RUNBOOK, audit, generated_at: ts, source: "agent (mock)",
    };
  }

  // 3) reasoning — 진입 후보 요약.
  const cands = pickEntryCandidates(objects);
  const entryCand = cands.find((c) => c.id === entryId);
  reason(`진입점 = ${entryCand ? entryCand.title : entryId} (${entryCand?.reason ?? "지정된 대상"}). 여기서 관계 그래프를 따라간다.`);

  // 4) tool queryObjects(Endpoint) — 엔드포인트 목록 접지(자동 실행).
  runTool("queryObjects", { type: "Endpoint" }, toolQueryObjects(objects, { type: "Endpoint" }));

  // 5) tool traverseLinks(entry) — 진입점 이웃(serves/runsOn/hostedBy) 접지(자동 실행).
  const trav = runTool("traverseLinks", { objectId: entryId }, toolTraverseLinks(objects, links, { objectId: entryId }));

  // 6) reasoning — first-anomaly 시간축으로 근본원인 판정(상관≠인과, "추정").
  reason("각 hop 의 첫 이상(first-anomaly) 시각을 비교해, 가장 먼저 무너진 hop 을 추정 근본원인으로 본다(상관이 곧 인과는 아님).");

  // grounding — buildRootCausePath(IMP-58) 로 근본원인 경로 산출(단일 출처).
  const rcp = buildRootCausePath(objects, links, entryId);

  // traverse 가 아무 이웃도 못 찾았고 경로도 단일 hop 이면 grounding 빈약 — 그래도 진입점 자체는 접지됨.
  // 후보 = 경로의 hop 을 confidence 순위로. critical hop 최상, blast-radius/상류 후속.
  const byId = new Map(objects.map((o) => [o.id, o]));
  const candidates: RcaCandidate[] = rcp.hops
    .filter((h) => h.status !== "ok") // 이상 있는 hop 만 원인 후보(정상 hop 은 인용만).
    .map((h) => {
      const obj = byId.get(h.id);
      const objectType = (obj?.type ?? "Endpoint") as ObjectType;
      // confidence — critical=최상, blast=중간, 그 외 상태기반. first-anomaly 가 이를수록↑(결정적).
      const base = h.critical ? 0.9 : h.blastRadius ? 0.55 : h.status === "crit" ? 0.7 : 0.5;
      const earlyBoost = h.firstAnomalyIndex >= 0 ? (24 - h.firstAnomalyIndex) / 24 * 0.1 : 0;
      const confidence = +Math.min(0.98, base + earlyBoost).toFixed(2);
      // 인용 — 이 hop objectId + traverse 로 접지한 이웃 중 이 hop(있으면). grounding 강제.
      const citations = Array.from(new Set([h.id, ...trav.objectIds.filter((id) => id === h.id)]));
      const verb = SUGGESTED_ACTION[objectType];
      const claim = h.critical
        ? `추정 근본원인: ${obj?.title ?? h.id} 에서 가장 이른 이상(${h.firstAnomalyLabel})이 관측됨.`
        : h.blastRadius
          ? `영향 확산(blast-radius): ${obj?.title ?? h.id} 로 문제가 번질 수 있음.`
          : `연관 이상: ${obj?.title ?? h.id} (${h.firstAnomalyLabel}).`;
      return {
        objectId: h.id, title: obj?.title ?? h.id, objectType, confidence, claim, citations,
        suggestedAction: verb ? { actionType: verb, target: h.id } : undefined,
      };
    })
    .sort((a, b) => b.confidence - a.confidence);

  // 후보가 하나도 없으면(모든 hop 정상 = grounding 은 됐지만 원인 없음) → runbook fallback 로 안내.
  if (candidates.length === 0) {
    reason("경로 상 이상 hop 이 없다. 명확한 근본원인 후보가 없어 정적 점검 절차를 안내한다.");
    return {
      traceId, intent, steps, candidates: [], grounded: false,
      fallbackRunbook: FALLBACK_RUNBOOK, audit, generated_at: ts, source: "agent (mock)",
    };
  }

  return {
    traceId, intent, steps, candidates, grounded: true,
    audit, generated_at: ts, source: "agent (mock)",
  };
}

// ══════════════════════════════════════════════════════════════════════════
// IMP-78 — 클러스터 인사이트(Dynamo 로컬 모델이 온톨로지 근거로 군집·패턴 도출)
// ══════════════════════════════════════════════════════════════════════════
// 위 runAgentLoop(결정적 RCA)는 단일 진입점 원인추적용이라 그대로 둔다. 여기는 그 위의 **생성적** 레이어:
// 온톨로지 스냅샷을 압축해 로컬 모델에 구조화 프롬프트로 보내고, 모델이 "유사 상태 GPU 군집 · 반복 hot-node
// 패턴 · 유휴 할당갭 집중 노드" 같은 인사이트를 objectId 인용과 함께 낸다.
//
// **핵심 안전장치(HARD grounding)**: 모델 출력(raw)은 신뢰하지 않는다. parseAndGroundInsights 가 각 claim 의
// 인용을 **온톨로지 실재 id 집합(validIds)** 으로 필터하고, 유효 인용이 0개면 그 insight 를 드롭한다 →
// 지어낸 claim 이 화면에 못 샌다. 이 파이프라인은 transport 와 무관(mock 이든 실 Dynamo 든 동일 강제).
//
// **read-only**: 인사이트는 suggestedAction 을 만들지 않는다. 모든 mutation 은 오직 RCA 카드의 <ActionForm>
// (IMP-59) confirm + capability 게이팅으로만 — two-tier 불변식 유지.

// GPU/Node props 에서 숫자 필드를 안전 추출(문자/undefined 는 fallback).
function numProp(o: OntologyObject, key: string, fallback = 0): number {
  const v = (o.props as Record<string, unknown>)[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

// 압축된 grounding 컨텍스트 — 스냅샷 전체를 프롬프트에 넣지 않고, 인사이트에 필요한 파생 요약 + 실재 id 집합만.
export interface InsightGroundingContext {
  validIds: Set<string>;                 // 온톨로지 실재 objectId(인용 화이트리스트)
  objectCount: number;
  linkCount: number;
  // GpuDevice 요약 — util/mem/temp + 상태. 군집·hot-node·유휴갭 근거.
  gpus: { id: string; title: string; util: number; mem: number; temp: number; throttled: boolean; status: string }[];
  // Node → 그 위 GPU id 묶음(hostedBy 역방향). hot-node/유휴갭 집중 판정 근거.
  nodeGpus: { nodeId: string; nodeTitle: string; gpuIds: string[] }[];
  // 상태 히스토그램(요약 텍스트용).
  statusHist: Record<string, number>;
}

// 스냅샷 압축 — 결정적. GpuDevice util/mem/temp/throttle 요약 + 노드별 GPU 묶음 + 실재 id 집합.
export function buildInsightGroundingContext(objects: OntologyObject[], links: OntologyLink[]): InsightGroundingContext {
  const validIds = new Set(objects.map((o) => o.id));
  const gpus = objects
    .filter((o) => o.type === "GpuDevice")
    .map((o) => {
      const throttleStr = String((o.props as Record<string, unknown>).throttle ?? "");
      return {
        id: o.id,
        title: o.title,
        util: numProp(o, "util_perc"),
        mem: numProp(o, "mem_perc"),
        temp: numProp(o, "temp_c"),
        throttled: throttleStr !== "" && throttleStr !== "제약 없음",
        status: o.status,
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)); // 결정적 정렬

  // Node → GPU (hostedBy: gpu --hostedBy--> node). 노드별로 GPU id 를 결정적으로 묶는다.
  const nodeById = new Map(objects.filter((o) => o.type === "Node").map((o) => [o.id, o]));
  const nodeGpuMap = new Map<string, string[]>();
  for (const l of links) {
    if (l.linkKind === "hostedBy" && nodeById.has(l.to) && validIds.has(l.from)) {
      const arr = nodeGpuMap.get(l.to) ?? [];
      arr.push(l.from);
      nodeGpuMap.set(l.to, arr);
    }
  }
  const nodeGpus = Array.from(nodeGpuMap.entries())
    .map(([nodeId, gpuIds]) => ({
      nodeId,
      nodeTitle: nodeById.get(nodeId)?.title ?? nodeId,
      gpuIds: gpuIds.slice().sort(),
    }))
    .sort((a, b) => (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0));

  const statusHist: Record<string, number> = {};
  for (const o of objects) statusHist[o.status] = (statusHist[o.status] ?? 0) + 1;

  return { validIds, objectCount: objects.length, linkCount: links.length, gpus, nodeGpus, statusHist };
}

// 구조화 프롬프트 — 실 Dynamo 로 나갈 때 이 문자열이 system+user 로 실린다. 규칙(인용 필수·JSON-only·지어내지 말 것)을 명시.
// mock 은 이 프롬프트를 실제로 "실행"하지 않지만(결정적 completion 을 직접 만든다), audit·실경로 계약을 위해 동일하게 구성.
export function buildInsightPrompt(ctx: InsightGroundingContext): { system: string; user: string } {
  const system =
    "너는 GPU 인프라 관제 분석가다. 아래 온톨로지 컨텍스트(객체/메트릭 요약)만 근거로 '클러스터 인사이트'를 도출한다. " +
    "규칙: (1) 각 insight 는 반드시 컨텍스트에 실재하는 objectId 를 citations 로 인용한다. " +
    "(2) 컨텍스트에 없는 사실·id 를 지어내지 않는다(모르면 비운다). (3) 아래 JSON 스키마로만 답한다. " +
    '스키마: {"insights":[{"kind":"gpu-cluster|hot-node|idle-alloc-gap|recurring-pattern","title":string,"claim":string,"citations":[objectId...],"severity":"info|warn|crit"}]}';
  // 컨텍스트 압축 — 프롬프트 토큰을 아끼려고 요약만 싣는다(전체 스냅샷 금지).
  const gpuLines = ctx.gpus
    .map((g) => `${g.id} util=${(g.util * 100).toFixed(0)}% mem=${(g.mem * 100).toFixed(0)}% temp=${g.temp}C throttle=${g.throttled ? "y" : "n"} status=${g.status}`)
    .join("\n");
  const nodeLines = ctx.nodeGpus.map((n) => `${n.nodeId}: [${n.gpuIds.join(", ")}]`).join("\n");
  const user =
    `객체 ${ctx.objectCount}개 · 링크 ${ctx.linkCount}개. 상태 분포 ${JSON.stringify(ctx.statusHist)}.\n` +
    `GPU 요약:\n${gpuLines || "(GPU 없음)"}\n노드별 GPU:\n${nodeLines || "(노드 없음)"}`;
  return { system, user };
}

// 결정적 mock "모델 출력"(raw JSON 문자열) — context 의 실제 군집/hot-node/유휴갭을 근거로 만든다.
// **일부러 인용 없는/가짜 id claim 을 하나 섞는다** → parseAndGroundInsights 가 드롭함을 mock 자체로 증명(hallucination 방어 회귀 가드).
export function mockModelInsightCompletion(ctx: InsightGroundingContext): string {
  const insights: ClusterInsight[] = [];

  // (1) 유사 상태 GPU 군집 — 사용률 밴드(low<0.35 / mid 0.35~0.7 / high≥0.7)로 GPU 를 묶어,
  //     같은 밴드에 2개 이상이면 "유사 상태 군집"으로 본다(Palantir 식 유사-객체 군집). 결정적.
  const band = (u: number): "high" | "mid" | "low" => (u >= 0.7 ? "high" : u >= 0.35 ? "mid" : "low");
  const bandLabel: Record<"high" | "mid" | "low", string> = { high: "고사용(≥70%)", mid: "중사용(35~70%)", low: "저사용(<35%)" };
  const byBand: Record<string, typeof ctx.gpus> = { high: [], mid: [], low: [] };
  for (const g of ctx.gpus) byBand[band(g.util)].push(g);
  // 가장 큰(동률이면 high>mid>low) 군집 하나를 대표 인사이트로 — 결정적 선택.
  const bandOrder: ("high" | "mid" | "low")[] = ["high", "mid", "low"];
  const topBand = bandOrder.filter((b) => byBand[b].length >= 2).sort((a, b) => byBand[b].length - byBand[a].length)[0];
  if (topBand) {
    const members = byBand[topBand];
    insights.push({
      id: "ins-gpu-cluster",
      kind: "gpu-cluster",
      title: `유사 상태 GPU 군집(${bandLabel[topBand]})`,
      claim: `사용률이 ${bandLabel[topBand]} 대역에 몰린 GPU ${members.length}개가 유사 상태 군집을 이룹니다(추정). 동일 워크로드 쏠림/여유일 수 있어 배치·리밸런싱 검토 대상입니다.`,
      citations: members.map((g) => g.id),
      severity: topBand === "high" ? "warn" : "info",
    });
  }

  // (2) 반복 hot-node 패턴 — 노드에 얹힌 GPU 중 열/제약 징후(온도≥80°C 또는 throttle)가 있으면 hot-node.
  //     온도 임계(80)는 topology status warn 임계와 통일 → 단일 throttle 비트에 의존하지 않아 결정적·안정적.
  for (const n of ctx.nodeGpus) {
    const hotOnNode = n.gpuIds.filter((gid) => {
      const g = ctx.gpus.find((x) => x.id === gid);
      return g && (g.temp >= 80 || g.throttled);
    });
    if (hotOnNode.length >= 1) {
      insights.push({
        id: `ins-hot-node-${n.nodeId}`,
        kind: "hot-node",
        title: `반복 hot-node 패턴 — ${n.nodeTitle}`,
        claim: `${n.nodeTitle} 에 얹힌 GPU 중 ${hotOnNode.length}개에서 고온/throttle(열·전력 제약) 징후가 관측됩니다(추정). 노드 단위 냉각·배치 점검 대상.`,
        citations: [n.nodeId, ...hotOnNode],
        severity: "warn",
      });
    }
  }

  // (3) 유휴 할당갭이 몰린 노드 — 사용률이 낮은(util<0.15, 유휴) GPU 가 한 노드에 몰려 있으면 회수·재배치 후보.
  //     (mem_perc 가 없는 스냅샷도 있어 util 기준으로 판정 — 결정적.)
  for (const n of ctx.nodeGpus) {
    const idle = n.gpuIds.filter((gid) => {
      const g = ctx.gpus.find((x) => x.id === gid);
      return g && g.util < 0.15;
    });
    if (idle.length >= 1) {
      insights.push({
        id: `ins-idle-gap-${n.nodeId}`,
        kind: "idle-alloc-gap",
        title: `유휴 할당갭 집중 — ${n.nodeTitle}`,
        claim: `${n.nodeTitle} 에서 사용률이 매우 낮은(유휴 할당) GPU ${idle.length}개가 몰려 있습니다(추정). 회수·재배치로 용량 확보 가능.`,
        citations: [n.nodeId, ...idle],
        severity: "info",
      });
    }
  }

  // (4) **hallucination 재현** — 인용 없는 claim(모델이 지어낸 케이스). 파이프라인이 반드시 드롭한다.
  insights.push({
    id: "ins-uncited-hallucination",
    kind: "recurring-pattern",
    title: "네트워크 전반의 잠재적 병목(근거 미상)",
    claim: "클러스터 전반에서 주기적 지연 급증 패턴이 의심됩니다(추정). — 인용 없음.",
    citations: [], // ← 인용 없음 → 드롭 대상.
    severity: "info",
  });

  // (5) **가짜 id 인용** — 온톨로지에 없는 id 만 인용(모델 hallucination). validIds 필터 후 유효 0 → 드롭.
  insights.push({
    id: "ins-fake-id",
    kind: "recurring-pattern",
    title: "존재하지 않는 노드의 이상",
    claim: "gpu:ghost-9 에서 이상이 반복됩니다(추정).",
    citations: ["gpu:ghost-9", "node:does-not-exist"],
    severity: "warn",
  });

  return JSON.stringify({ insights });
}

// raw 모델 출력 → HARD grounding 강제. JSON 파싱 실패는 throw 하지 않고 빈 결과(모델이 규칙을 어겨도 화면은 안전).
// 각 insight 의 citations 를 validIds 로 필터 → 유효 인용 0개면 드롭. 남은 것 + 드롭 수 반환.
export function parseAndGroundInsights(
  raw: string,
  validIds: Set<string>,
): { insights: ClusterInsight[]; droppedCount: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { insights: [], droppedCount: 0 }; // 모델이 JSON 이 아닌 답 → 지어낸 것 표시 안 함.
  }
  const rawList = (parsed && typeof parsed === "object" && Array.isArray((parsed as { insights?: unknown }).insights))
    ? ((parsed as { insights: unknown[] }).insights)
    : [];
  const KINDS: InsightKind[] = ["gpu-cluster", "hot-node", "idle-alloc-gap", "recurring-pattern"];
  const kept: ClusterInsight[] = [];
  let dropped = 0;
  for (const item of rawList) {
    if (!item || typeof item !== "object") { dropped++; continue; }
    const o = item as Record<string, unknown>;
    const rawCites = Array.isArray(o.citations) ? (o.citations as unknown[]).filter((c): c is string => typeof c === "string") : [];
    // **HARD grounding** — 온톨로지 실재 id 만 인용으로 인정(중복 제거·결정적 정렬).
    const cites = Array.from(new Set(rawCites.filter((id) => validIds.has(id)))).sort();
    if (cites.length === 0) { dropped++; continue; } // 유효 인용 없음 → 드롭(hallucination 금지).
    const kind = KINDS.includes(o.kind as InsightKind) ? (o.kind as InsightKind) : "recurring-pattern";
    const sev = o.severity === "crit" || o.severity === "warn" || o.severity === "info" ? o.severity : "info";
    kept.push({
      id: typeof o.id === "string" && o.id ? o.id : `ins-${kept.length}`,
      kind,
      title: typeof o.title === "string" ? o.title : "인사이트",
      claim: typeof o.claim === "string" ? o.claim : "",
      citations: cites,
      severity: sev,
    });
  }
  return { insights: kept, droppedCount: dropped };
}

// 스냅샷 압축 요약(사람용) — grounded=false 사유·투명성 표시에 쓴다.
function summarizeGrounding(ctx: InsightGroundingContext): string {
  const hot = ctx.gpus.filter((g) => g.util >= 0.85).length;
  const throttled = ctx.gpus.filter((g) => g.throttled).length;
  return `객체 ${ctx.objectCount}개 · 링크 ${ctx.linkCount}개 · GPU ${ctx.gpus.length}개(고사용 ${hot}, throttle ${throttled}) · 노드 ${ctx.nodeGpus.length}개를 근거로 분석했습니다.`;
}

// ── 클러스터 인사이트 조립(mock 순수 진입) ───────────────────────────────────
// objects/links(스냅샷) → 압축 컨텍스트 → (모델 completion) → HARD grounding → AgentInsightRun.
//   rawOverride: 실 Dynamo 가 낸 completion 을 주입하는 seam(테스트/실경로). 미지정이면 결정적 mock completion 사용.
//   nowIso: audit 타임스탬프(결정성 위해 주입 가능).
export function buildAgentInsights(
  objects: OntologyObject[],
  links: OntologyLink[],
  opts: { traceId: string; nowIso?: string; rawOverride?: string },
): AgentInsightRun {
  const ts = opts.nowIso ?? new Date().toISOString();
  const traceId = opts.traceId;
  const audit: AgentAuditEntry[] = [];
  const rec = (kind: AgentAuditEntry["kind"], detail: string) => audit.push({ traceId, kind, detail, ts });

  const ctx = buildInsightGroundingContext(objects, links);
  // 구조화 프롬프트 구성 — 실경로(VITE_MOCK=off)에서 이 system+user 가 Dynamo /playground/chat 으로 실린다.
  // mock 은 이를 실제로 "실행"하진 않지만(결정적 completion 사용), 실경로 계약·audit 을 위해 동일하게 구성한다.
  const prompt = buildInsightPrompt(ctx);
  // audit — 마스킹된 메타만(원문 컨텍스트/시크릿 로깅 금지): 프롬프트 길이·규칙 존재 여부 + 컨텍스트 규모만.
  rec("prompt", `insight prompt(system=${prompt.system.length}b, user=${prompt.user.length}b) · ctx(objs=${ctx.objectCount}, links=${ctx.linkCount}, gpus=${ctx.gpus.length})`);
  rec("reasoning", "온톨로지 스냅샷을 압축해 로컬 모델에 구조화 프롬프트로 인사이트를 요청한다(인용 필수).");

  // raw "모델 출력" — 실경로면 주입값(rawOverride), mock 이면 결정적 completion.
  const raw = opts.rawOverride ?? mockModelInsightCompletion(ctx);
  const { insights, droppedCount } = parseAndGroundInsights(raw, ctx.validIds);

  rec("reasoning", `모델 출력에서 인용 강제(HARD grounding): 표시 ${insights.length}건, 인용 없어 드롭 ${droppedCount}건.`);

  return {
    traceId,
    mode: "insights",
    insights,
    grounded: insights.length > 0,
    groundingSummary: summarizeGrounding(ctx),
    droppedCount,
    audit,
    generated_at: ts,
    source: "agent-insights (mock)",
  };
}
