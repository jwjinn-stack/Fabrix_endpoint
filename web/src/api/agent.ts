// IMP-60 — 온톨로지 접지 AI Agent 루프 (순수 seam).
//
// "이 느린 엔드포인트 원인 찾아줘" → 로컬 모델이 온톨로지를 tool 로 조회(read-only)하고
// 근본원인 후보 + 실행 가능 Action 을 제안한다(docs §3·§5.4, AWS grounded-agent Pattern 5).
// 새 데이터 모델을 발명하지 않는다 — 기존 온톨로지(IMP-56) + buildRootCausePath(IMP-58) 만 grounding 으로 쓴다.
//
// - 의존성 0개(프로젝트 ethos). 순수 함수만 두어 tool 실행·ReAct 순서·grounding-empty fallback 을 단위 테스트로 가드.
// - **핵심 안전장치(two-tier 게이팅)**: 이 파일의 tool 은 조회 3종(queryObjects/traverseLinks/getIncidents)뿐.
//   mutating tool 은 존재하지 않는다 → 모델이 confirm 없이 mutation 을 부를 구조적 경로가 없다.
//   mutation 은 오직 <ActionForm>(IMP-59) + evaluateSubmission(capability+status) 게이팅으로만 실행된다.
// - VITE_MOCK=off 는 transport 만 스왑(client.runAgent 가 그대로 실백엔드로). tool 스키마는 fork 하지 않는다.

import type {
  AgentAuditEntry, AgentRun, AgentStep, AgentToolName, AgentToolResult,
  ObjectType, OntologyLink, OntologyObject, RcaCandidate,
} from "./types";
import { buildRootCausePath, defaultEntry, pickEntryCandidates } from "./investigate";

// ── read-only tool 구현 ─────────────────────────────────────────────────────
// 실제 MCP tool 과 동일한 시그니처(objectId 소스 반환). 전부 온톨로지 스냅샷 위에서 조회만 한다.
//
// tool: queryObjects(type?, filter?) — 명사(Object)를 type/부분일치로 추린다.
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
