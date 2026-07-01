// IMP-61 — 내장 데모 시나리오 드라이버 (순수, 의존성 0).
//
// "slow endpoint → saturated GPU / hot node → recommended cordon+scale" 를 결정적으로 재생하기 위한
// 목적 특화 seeded 온톨로지 fixture + 순서 있는 narration step. 새 traversal 을 발명하지 않는다 —
// evidence surface 는 오직 buildRootCausePath(IMP-58) 를 재사용한다(단일 출처).
//
// 왜 별도 fixture 인가: 기존 mock seed(qwen25-vl-7b NotReady)는 Model 에서 dead-end 라 GPU→Node 포화
// 경로가 생성되지 않는다(probe 확인). 정확한 서사를 결정적으로 보이려면 이 walkthrough 전용 fixture 가 필요하다.
// (mock-first: 실 K8s mutating·실백엔드 호출 없음. Action 은 "제안"일 뿐 — 실행은 ActionForm confirm 게이팅.)
//
// thin-layer 원칙: 이 모듈은 (1) 순수 fixture + (2) buildRootCausePath 호출 + (3) step 배열뿐이다.
// Investigate 화면은 이 결과를 기존 경로 렌더에 주입하고 step 하이라이트만 얹는다(rebuild 아님).

import type { OntologyLink, OntologyObject } from "./types";
import { buildRootCausePath, type Hop, type RootCausePath } from "./investigate";
import { getActionSpec } from "../actions/registry";

// 데모 진입 Object — 느린 Endpoint. Investigate 는 이 id 를 진입점으로 경로를 확장한다.
export const DEMO_ENTRY_ID = "endpoint:demo-slow-chat";

// narration step 한 개 — 특정 hop(objectId)에 붙는 사람용 설명 + (있으면) 권장 조치.
// action.actionType 은 ACTION_REGISTRY verb 이름(cordonNode/scaleReplicas)과 정합해야 한다.
export interface DemoStep {
  id: string;                 // 이 step 이 가리키는 hop 의 OntologyObject id
  title: string;              // 짧은 제목(사람용)
  narration: string;          // 이 hop 에서 무엇을 관측했는지(escape 렌더)
  action?: { actionType: string; target: string; label: string; reason: string }; // 권장 조치(제안일 뿐)
}

export interface DemoScenario {
  objects: OntologyObject[];
  links: OntologyLink[];
  entryId: string;
  path: RootCausePath;   // buildRootCausePath 산출(재사용 — traversal 재구현 아님)
  steps: DemoStep[];     // 순서 있는 walkthrough(path.hops 순서와 정합). fixture 이상 시 빈 배열.
}

// ── 목적 특화 seeded fixture ──────────────────────────────────────────────
// 척추: Endpoint(demo-slow-chat) --serves--> Model(demo-chat-32b) --runsOn--> GpuDevice(demo-gpu-0)
//        --hostedBy--> Node(demo-node-a). 같은 Node 에 다른 Service(demo-svc-rag)가 hostedBy → blast-radius.
// 상태 설계: 상류(GPU/Node)를 crit 으로 두어 first-anomaly 가 더 이르게 관측되도록(signalsFor 의 sev·seedBias).
//   → 추정 근본원인(criticalId)이 포화된 GPU/Node 로 수렴 = "saturated GPU / hot node" 서사.
function demoObjects(): OntologyObject[] {
  return [
    // 진입 — 느린 채팅 Endpoint(사용자 체감 지연). ready=true 지만 지연이 warn.
    { id: DEMO_ENTRY_ID, type: "Endpoint", title: "chat-32b 엔드포인트", status: "warn", revision: 1,
      props: { namespace: "fabrix", model: "demo-chat-32b", backend: "dynamo-agg-router", replicas: 2, ready: true } },
    // 서빙 모델 — 지연 상승(레플리카 부족 정황). scale 권장 대상.
    { id: "model:demo-chat-32b", type: "Model", title: "Demo Chat 32B", status: "warn", revision: 1,
      props: { name: "demo-chat-32b", provider: "Demo", type: "chat", context_window: 131072, replicas: 2 } },
    // 포화 GPU — 사용률 임계 초과(가장 이른 이상). 근본원인 상류.
    { id: "gpu:demo-gpu-0", type: "GpuDevice", title: "GPU0 (demo-node-a)", status: "crit", revision: 1,
      props: { device: "demo-node-a/gpu0", util_perc: 0.97, mem_perc: 0.93, temp_c: 88 } },
    // 핫 노드 — CPU/네트워크 압박(cordon 권장 대상).
    { id: "node:demo-node-a", type: "Node", title: "demo-node-a", status: "crit", revision: 1,
      props: { hostname: "demo-node-a", cpu_util: 0.94, mem_util: 0.9, net_err_per_s: 12 } },
    // 같은 노드의 다른 Service — blast-radius(영향 확산).
    { id: "service:demo-svc-rag", type: "Service", title: "사내지식 RAG", status: "warn", revision: 1,
      props: { name: "demo-svc-rag", qps: 18, error_rate: 0.03 } },
  ];
}

function demoLinks(): OntologyLink[] {
  return [
    { from: DEMO_ENTRY_ID, to: "model:demo-chat-32b", linkKind: "serves" },
    { from: "model:demo-chat-32b", to: "gpu:demo-gpu-0", linkKind: "runsOn" },
    { from: "gpu:demo-gpu-0", to: "node:demo-node-a", linkKind: "hostedBy" },
    // 같은 노드에 hostedBy 된 다른 Service → 척추 종점 이후 blast-radius 로 한 hop 확장.
    { from: "service:demo-svc-rag", to: "node:demo-node-a", linkKind: "hostedBy" },
  ];
}

// hop objectId → 권장 조치(제안). ACTION_REGISTRY verb 와 정합(cordonNode=Node, scaleReplicas=Model).
// verb 가 레지스트리에 없으면(계약 어긋남) 조치를 붙이지 않는다(방어적).
function actionForHop(hop: Hop): DemoStep["action"] | undefined {
  if (hop.object.type === "Node" && getActionSpec("cordonNode")) {
    return { actionType: "cordonNode", target: hop.id, label: "노드 cordon",
      reason: "핫 노드의 신규 스케줄을 차단해 포화 확산을 멈춘다(영향 서비스 보호)." };
  }
  if (hop.object.type === "Model" && getActionSpec("scaleReplicas")) {
    return { actionType: "scaleReplicas", target: hop.id, label: "레플리카 조정",
      reason: "레플리카를 늘려 지연을 흡수한다(포화 GPU 의존을 완화)." };
  }
  return undefined;
}

// hop → narration 문구. "추정 근본원인 / 영향 경로" 톤(상관≠인과, 과장 금지).
function narrate(hop: Hop, isEntry: boolean, isCritical: boolean): string {
  if (isEntry) return `사용자 체감 지연이 상승한 진입 엔드포인트입니다. 관계 그래프를 따라 상류로 원인을 추적합니다.`;
  if (isCritical) {
    switch (hop.object.type) {
      case "GpuDevice": return `가장 이른 이상(${hop.firstAnomalyLabel})이 이 GPU 에서 관측됩니다 — 사용률 포화가 추정 근본원인입니다.`;
      case "Node": return `핫 노드(${hop.firstAnomalyLabel})가 추정 근본원인입니다 — CPU·네트워크 압박이 상류로 전파됩니다.`;
      default: return `가장 이른 이상(${hop.firstAnomalyLabel})이 관측된 추정 근본원인 hop 입니다.`;
    }
  }
  if (hop.blastRadius) return `같은 노드에 얹힌 다른 서비스로 영향이 번질 수 있습니다(blast-radius).`;
  switch (hop.object.type) {
    case "Model": return `서빙 모델의 지연이 함께 상승합니다(${hop.firstAnomalyLabel}) — 레플리카 여력 부족 정황.`;
    case "GpuDevice": return `모델이 얹힌 GPU 로 내려갑니다(${hop.firstAnomalyLabel}).`;
    case "Node": return `GPU 를 담은 노드로 내려갑니다(${hop.firstAnomalyLabel}).`;
    default: return `연관 이상: ${hop.object.title} (${hop.firstAnomalyLabel}).`;
  }
}

// path(hops)로부터 순서 있는 narration step 을 만든다. 반드시 path.hops 순서를 보존한다.
// 권장 조치(cordon/scale)가 붙은 hop 은 그 조치를 step.action 으로 노출한다.
function stepsFromPath(path: RootCausePath): DemoStep[] {
  if (!path.found || path.hops.length === 0) return [];
  return path.hops.map((hop, i) => ({
    id: hop.id,
    title: hop.object.title,
    narration: narrate(hop, i === 0, hop.id === path.criticalId),
    action: actionForHop(hop),
  }));
}

// buildDemoScenario — 데모 시나리오 1건을 결정적으로 조립한다.
//   fixture(objects/links) → buildRootCausePath(재사용) → 순서 있는 step. 이상 시 steps=[] (throw 금지).
export function buildDemoScenario(): DemoScenario {
  const objects = demoObjects();
  const links = demoLinks();
  const entryId = DEMO_ENTRY_ID;
  const path = buildRootCausePath(objects, links, entryId);
  return { objects, links, entryId, path, steps: stepsFromPath(path) };
}

// 테스트 전용 — 임의 fixture 로 step 생성 규칙을 검증(bad/missing seed graceful 포함).
// (프로덕션 경로는 buildDemoScenario 만 쓴다. traversal 은 여기서도 buildRootCausePath 재사용.)
export function buildScenarioFrom(objects: OntologyObject[], links: OntologyLink[], entryId: string): DemoScenario {
  const path = buildRootCausePath(objects, links, entryId);
  return { objects, links, entryId, path, steps: stepsFromPath(path) };
}
