// K8s 스냅샷 파생(IMP-91) — 온톨로지 객체/링크에서 **결정적으로** 파생하는 순수 함수.
//
// IMP-93: 이 함수를 mock.ts 밖의 순수 모듈로 분리했다. 이유 = ObjectView/COP 의 근거(Evidence) 패널
// (EvidencePanel)이 이 파생을 소비하는데, mock.ts 는 main.tsx 가 동적 import(VITE_MOCK=off 면 아예
// 안 받음)로 부트 청크에서 분리한 모듈이라(IMP-85), 컴포넌트가 mock.ts 를 정적 import 하면 mock 전체가
// 부트 청크로 끌려온다(격리 붕괴). buildK8sSnapshot 은 fetch/부작용 없는 순수 파생이므로 여기로 옮기고,
// mock.ts·agent.ts 는 이 모듈을 재-export/재사용한다(단일 출처 유지).
//
// 실 클러스터 상태가 아니라 mock 파생이며(정직성), 실연동은 official kubernetes-mcp-server SPIKE —
// 이 함수 자리만 실 kube-mcp 응답으로 스왑하면 응답 스키마(K8sSnapshot)는 고정.
//
// **온톨로지 상관**: crit GPU/Node → 그 노드가 NotReady, 그 위 파드에 OOMKilled + 재시작↑ +
//   OOMKilling/BackOff 이벤트. crit Endpoint(NotReady 엔드포인트) → 그 배포 rollout unavailable.
// **순수·격리**: objects/links 배열만 받는 순수 함수 → 빈/부분 스냅샷에서 throw 없이 빈 결과.
import type { K8sDeployment, K8sEvent, K8sNode, K8sPod, K8sSnapshot, OntologyLink, OntologyObject } from "./types";

// FNV-1a 해시(결정적) — mock.ts 와 동일 규약(재현 가능한 파드 이름/노드 배정). 순수.
const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

export function buildK8sSnapshot(objects: OntologyObject[], links: OntologyLink[]): K8sSnapshot {
  const pods: K8sPod[] = [];
  const nodes: K8sNode[] = [];
  const events: K8sEvent[] = [];
  const deployments: K8sDeployment[] = [];

  const nodeObjs = objects.filter((o) => o.type === "Node");
  const gpuObjs = objects.filter((o) => o.type === "GpuDevice");
  const epObjs = objects.filter((o) => o.type === "Endpoint");

  // GpuDevice --hostedBy--> Node 로 각 노드의 GPU 상태를 모아 노드 이상 판정(단일 출처: 온톨로지 링크).
  const gpuById = new Map(gpuObjs.map((o) => [o.id, o]));
  const nodeGpuStatuses = new Map<string, string[]>();
  for (const l of links) {
    if (l.linkKind === "hostedBy" && gpuById.has(l.from)) {
      const arr = nodeGpuStatuses.get(l.to) ?? [];
      arr.push(gpuById.get(l.from)!.status);
      nodeGpuStatuses.set(l.to, arr);
    }
  }

  // ── Node ── 온톨로지 Node crit 또는 그 위 GPU 가 crit 이면 NotReady 로 상관.
  for (const n of nodeObjs) {
    const hostName = String((n.props as Record<string, unknown>).hostname ?? n.title);
    const gpuStatuses = nodeGpuStatuses.get(n.id) ?? [];
    const gpuCrit = gpuStatuses.includes("crit");
    const notReady = n.status === "crit" || gpuCrit;
    nodes.push({
      name: hostName,
      condition: notReady ? "NotReady" : "Ready",
      reason: notReady ? (gpuCrit ? "GPU 장애로 kubelet 이 Ready 조건을 잃음(추정)" : "KubeletNotReady") : undefined,
      objectId: n.id,
    });
    if (notReady) {
      events.push({
        reason: "NodeNotReady",
        message: `Node ${hostName} status is now: NodeNotReady`,
        involvedObject: `node/${hostName}`,
        count: 1,
        objectId: n.id,
      });
    }
  }

  // ── Pod ── Endpoint 를 파드의 상위로 삼는다(각 Endpoint = 하나의 서빙 배포). replicas 만큼 파드 생성.
  //   Endpoint 가 crit(NotReady) 이거나 그 Model 이 crit 이면 파드에 OOMKilled + 재시작↑ 을 상관시킨다.
  const nodeNames = nodes.map((x) => x.name);
  for (const ep of epObjs) {
    const p = ep.props as Record<string, unknown>;
    const ns = String(p.namespace ?? "fabrix");
    const replicas = Math.max(1, Number(p.replicas) || 1);
    const epName = ep.title;
    // 이 엔드포인트가 얹힌 노드(결정적): 이름 해시로 노드 배정(노드 없으면 이름만).
    const nodeName = nodeNames.length ? nodeNames[hash(ep.id) % nodeNames.length] : "";
    const nodeNotReady = nodes.find((x) => x.name === nodeName)?.condition === "NotReady";
    const bad = ep.status === "crit"; // NotReady 엔드포인트 → 파드 기동 실패/OOM 상관.
    for (let i = 0; i < replicas; i++) {
      const podName = `${epName}-${(hash(`${ep.id}:${i}`) % 90000 + 10000).toString(36)}`;
      const oom = bad && i === 0; // 대표 파드 1개가 OOMKilled(결정적).
      const failedSched = nodeNotReady && i === 0;
      const restarts = oom ? 5 + (hash(podName) % 8) : failedSched ? 3 : 0;
      const phase: K8sPod["phase"] = oom ? "Failed" : bad ? "Pending" : "Running";
      pods.push({
        name: podName, namespace: ns,
        phase, ready: phase === "Running",
        restarts, oomKilled: oom, node: nodeName,
        objectId: ep.id,
        reason: oom ? "CrashLoopBackOff" : failedSched ? "FailedScheduling" : undefined,
      });
      if (oom) {
        events.push({ reason: "OOMKilling", message: `Container 가 메모리 한계를 초과해 OOMKilled 되었습니다 (pod ${podName})`, involvedObject: `pod/${podName}`, count: restarts, objectId: ep.id });
        events.push({ reason: "BackOff", message: `Back-off restarting failed container (pod ${podName})`, involvedObject: `pod/${podName}`, count: restarts, objectId: ep.id });
      } else if (failedSched) {
        events.push({ reason: "FailedScheduling", message: `0/${nodeNames.length} nodes are available: 노드 ${nodeName} NotReady`, involvedObject: `pod/${podName}`, count: 1, objectId: ep.id });
      }
    }
    // ── Deployment ── Endpoint 하나당 배포 하나. crit → unavailable rollout.
    const desired = replicas;
    const available = bad ? Math.max(0, replicas - 1) : replicas;
    const unavailable = desired - available;
    deployments.push({
      name: epName, namespace: ns, desired, updated: desired, available, unavailable,
      rollout: unavailable === 0 ? "complete" : available === 0 ? "stalled" : "progressing",
      objectId: ep.id,
    });
  }

  // 결정적 정렬(재현 가능).
  pods.sort((a, b) => (a.name < b.name ? -1 : 1));
  nodes.sort((a, b) => (a.name < b.name ? -1 : 1));
  events.sort((a, b) => (a.involvedObject + a.reason < b.involvedObject + b.reason ? -1 : 1));
  deployments.sort((a, b) => (a.name < b.name ? -1 : 1));
  return { pods, nodes, events, deployments };
}
