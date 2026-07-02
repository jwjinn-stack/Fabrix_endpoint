// IMP-99 — 근거 파생 단일 seam: buildIncidentEvidence (순수·결정적·의존성 0).
//
// 인시던트 explainability 의 **단일 출처**. "objectId → 상관 K8sPod/K8sEvent/K8sDeployment + 감지/큐 신호
// → 신호→추정원인→영향" 을 한 번만 조립한다. detection.ts(signalsForObject·probableCauseText·
// indexFirstAnomalies)와 investigate.ts(buildRootCausePath, indexFirstAnomalies 경유)와 K8s 스냅샷을
// **조립**할 뿐, 새 파생 규칙을 발명하지 않는다 — 임계·라벨·인용 규약이 화면마다 갈라지지 않게 한다.
//
// - 순수/결정적: 입력 동일 → 출력 동일(Date.now 미의존). 시각 라벨은 first-anomaly 파생.
// - 직렬화 가능: 원시값/배열/객체만 → JSON round-trip 동일(IMP-98 MCP tool 이 그대로 반환).
// - 환각 금지: 상관 근거가 하나도 없으면 empty=true + "수집된 이벤트 없음"(지어내지 않음).
// - confidence 규약 재사용: 상관 신호 ≥2 = high, 그 외 med(detection.ts / IBM Probable Cause 동형).
//
// 소비처(예정): detection.ts(KineticAlert) / investigate.ts(hop) / ObjectView(IMP-93) / MCP tool(IMP-98).

import type {
  DetectionSignal, K8sDeployment, K8sEvent, K8sPod, K8sSnapshot,
  ObjectStatus, ObjectType, OntologyLink, OntologyObject,
} from "./types";
import { indexFirstAnomalies, probableCauseText, signalsForObject } from "./detection";

// 근거 줄 한 개 — 신호(무엇/언제 + 출처 ref) → 추정원인 → 영향 + 신뢰도 + 인용 소스.
export interface EvidenceLine {
  id: string;                 // 결정적 식별자(kind:seq) — 렌더 key / 안정 정렬용
  kind: DetectionSignal["kind"] | "k8sEvent" | "k8sPod" | "k8sDeployment"; // 근거 계열
  signal: {
    what: string;             // 신호 서술(escape 렌더)
    when: string;             // 관측 시각 라벨("12분 전" 등, 상대) — Date.now 미의존
    sourceRef: string;        // 주 출처 ref(objectId / pod/<name> / event reason 등)
  };
  probableCause: string;      // 이 신호의 추정 원인(상관≠인과 병기)
  impact: string;             // 추정 영향 서술
  confidence: "high" | "med"; // 이 줄의 신뢰도(전체 상관 신호 수 기반 — 단일 규약)
  sourceRefs: string[];       // 근거 인용(objectId·pod/<name>·node/<name>·deployment/<name>) — grounding 강제
}

// buildIncidentEvidence 결과 — 신호→추정원인→영향 구조체 + 근본원인 요약 + empty-state.
export interface IncidentEvidence {
  objectId: string;
  found: boolean;             // 대상 객체 존재 여부(false=미지 objectId)
  objectType?: ObjectType;
  title?: string;
  status?: ObjectStatus;
  lines: EvidenceLine[];      // severity/first-anomaly 순 정렬(가장 이른 이상이 상단)
  rootCauseSummary: string;   // 짧은 추정 근본원인 요약(probableCauseText 재사용)
  confidence: "high" | "med"; // 상관 신호 ≥2 → high
  signalCount: number;        // 상관된 총 신호 수(감지 + K8s)
  empty: boolean;             // 상관 근거가 하나도 없음(환각 금지 폴백)
  emptyReason?: string;       // empty 사유("수집된 이벤트 없음")
}

// 스냅샷 — 온톨로지(objects/links) + 선택적 K8s. k8s 미제공 시 감지/first-anomaly 만으로 조립(graceful).
export interface IncidentSnapshot {
  objects: OntologyObject[];
  links: OntologyLink[];
  k8s?: K8sSnapshot;
}

// 상태 랭킹(통증 우선: crit → warn → unknown → ok). detection.ts STATUS_RANK 와 동형(정렬 tie-break 용).
const STATUS_RANK: Record<ObjectStatus, number> = { crit: 0, warn: 1, unknown: 2, ok: 3 };

// K8s event reason → 추정 원인 문구(결정적). 상관≠인과 — "추정" 병기.
const EVENT_CAUSE: Record<K8sEvent["reason"], string> = {
  OOMKilling: "컨테이너 메모리 한계 초과(OOM)로 재기동 — 메모리 상향/리밋 점검 필요(추정)",
  BackOff: "반복 재기동 back-off — 기동 실패/크래시 루프 정황(추정)",
  CrashLoopBackOff: "크래시 루프 — 이미지/설정/의존성 기동 실패 정황(추정)",
  FailedScheduling: "스케줄 실패 — 노드 자원 부족/NotReady 정황(추정)",
  Unhealthy: "헬스체크 실패 — 프로브 임계/기동 지연 정황(추정)",
  NodeNotReady: "노드 Ready 조건 상실 — 상위 워크로드로 전파(추정)",
  Evicted: "리소스 압박으로 파드 축출(eviction) 정황(추정)",
};

// K8s event reason → 추정 영향 문구.
const EVENT_IMPACT: Record<K8sEvent["reason"], string> = {
  OOMKilling: "재기동 중 요청 실패·지연 급증",
  BackOff: "가용 레플리카 감소로 처리량 저하",
  CrashLoopBackOff: "엔드포인트 미준비(NotReady) — 요청 거부",
  FailedScheduling: "레플리카 확보 실패로 용량 부족",
  Unhealthy: "롤아웃 지연·트래픽 라우팅 제외",
  NodeNotReady: "노드 상의 전 워크로드 영향(광역 blast-radius)",
  Evicted: "축출된 파드의 요청 유실·재배치 지연",
};

// 감지 신호(detection) → 추정 영향 문구(kind 별, 결정적).
function detectionImpact(kind: DetectionSignal["kind"], type?: ObjectType): string {
  switch (kind) {
    case "alertrule": return "엔드포인트 지연/오류가 소비 앱으로 전파(추정)";
    case "throttle": return "GPU 스로틀로 상류 서빙 지연 유발(추정)";
    case "idleAlloc": return "VRAM 점유·미사용으로 스케줄 용량 낭비(추정)";
    case "saturation": return type === "Node" ? "노드 자원 포화가 위 워크로드로 번짐(추정)" : "포화로 처리량 저하(추정)";
    case "firstAnomaly": return "원인 경로 상 가장 이른 이상 — 이후 홉으로 전파(추정)";
    default: return "관계 그래프로 전파(추정)";
  }
}

// 신호 kind 별 추정 원인 문구(감지 신호에는 detail 이 이미 근거를 담으므로 짧은 인과 요약).
function detectionCause(kind: DetectionSignal["kind"], type?: ObjectType): string {
  switch (kind) {
    case "alertrule": return "임계 초과(alertrules) — 지연/오류 급증 정황(추정)";
    case "throttle": return "하드웨어 클럭 스로틀(열/신뢰성) 정황(추정)";
    case "idleAlloc": return "할당됐으나 미사용(유휴 할당 갭) 정황(추정)";
    case "saturation": return type === "Node" ? "노드 CPU/네트워크 포화 정황(추정)" : "자원 포화 정황(추정)";
    case "firstAnomaly": return "가장 이른 이상 관측 시각(추정 원인 시간축)";
    default: return "관계 그래프 상 이상 전파(추정)";
  }
}

// buildIncidentEvidence — objectId + 스냅샷을 받아 신호→추정원인→영향 근거 구조체를 조립한다(순수·결정적).
//   - 감지 신호: detection.signalsForObject(단일 출처) 재사용.
//   - first-anomaly: detection.indexFirstAnomalies(=investigate.buildRootCausePath 경유) 재사용.
//   - K8s 상관: snapshot.k8s 에서 objectId 일치 pods/events/deployments 를 결정적으로 뽑는다.
//   - 상관 근거 0 → empty=true + "수집된 이벤트 없음"(환각 금지).
export function buildIncidentEvidence(objectId: string, snapshot: IncidentSnapshot): IncidentEvidence {
  const { objects, links, k8s } = snapshot;
  const obj = objects.find((o) => o.id === objectId);

  // 미지 objectId — graceful 빈 결과(throw 금지).
  if (!obj) {
    return {
      objectId, found: false, lines: [],
      rootCauseSummary: "대상 객체를 찾을 수 없습니다.",
      confidence: "med", signalCount: 0, empty: true, emptyReason: "수집된 이벤트 없음",
    };
  }

  // first-anomaly(단일 출처) — 이 객체의 가장 이른 이상 시각(있으면).
  const firstAnomaly = indexFirstAnomalies(objects, links).get(obj.id) ?? null;

  const lines: EvidenceLine[] = [];
  let seq = 0;
  const nextId = (kind: string) => `${kind}:${seq++}`;

  // (A) 감지/큐 신호(detection.signalsForObject 재사용) — 각 신호 = 근거 줄 1개.
  const signals = signalsForObject(obj, firstAnomaly);
  for (const s of signals) {
    lines.push({
      id: nextId(s.kind),
      kind: s.kind,
      signal: { what: `${s.label} — ${s.detail}`, when: s.observedAt, sourceRef: s.citation },
      probableCause: detectionCause(s.kind, obj.type),
      impact: detectionImpact(s.kind, obj.type),
      confidence: "med", // 전체 신호 수 확정 후 아래에서 일괄 승격.
      sourceRefs: [s.citation, obj.id].filter((v, i, a) => v && a.indexOf(v) === i),
    });
  }

  // (B) K8s 상관(snapshot.k8s 제공 시) — objectId 일치 pods/events/deployments. 결정적.
  if (k8s) {
    const pods: K8sPod[] = k8s.pods.filter((p) => p.objectId === obj.id);
    const events: K8sEvent[] = k8s.events.filter((e) => e.objectId === obj.id);
    const deps: K8sDeployment[] = k8s.deployments.filter((d) => d.objectId === obj.id);

    // 이상 파드(재시작/OOM/Failed) 만 근거로 승격(정상 파드는 노이즈).
    for (const p of pods.filter((p) => p.restarts > 0 || p.oomKilled || p.phase === "Failed")) {
      const podRef = `pod/${p.name}`;
      lines.push({
        id: nextId("k8sPod"),
        kind: "k8sPod",
        signal: {
          what: `파드 ${p.phase}${p.oomKilled ? " · OOMKilled" : ""} · 재시작 ${p.restarts}회${p.reason ? ` (${p.reason})` : ""}`,
          when: firstAnomaly?.label ?? "최근",
          sourceRef: podRef,
        },
        probableCause: p.oomKilled
          ? "메모리 한계 초과(OOM)로 재기동 — 리밋/메모리 상향 점검(추정)"
          : "컨테이너 기동 실패/크래시 루프 정황(추정)",
        impact: "가용 레플리카 감소 → 요청 실패·지연",
        confidence: "med",
        sourceRefs: [podRef, obj.id],
      });
    }

    // 이벤트 — reason 별 결정적 원인/영향 문구. count 를 근거에 함께.
    for (const e of events) {
      lines.push({
        id: nextId("k8sEvent"),
        kind: "k8sEvent",
        signal: {
          what: `${e.reason} ×${e.count} — ${e.message}`,
          when: firstAnomaly?.label ?? "최근",
          sourceRef: e.involvedObject,
        },
        probableCause: EVENT_CAUSE[e.reason],
        impact: EVENT_IMPACT[e.reason],
        confidence: "med",
        sourceRefs: [e.involvedObject, obj.id],
      });
    }

    // 배포 rollout 미완료(stalled/progressing) — 용량 근거.
    for (const d of deps.filter((d) => d.rollout !== "complete")) {
      lines.push({
        id: nextId("k8sDeployment"),
        kind: "k8sDeployment",
        signal: {
          what: `rollout ${d.rollout} — 가용 ${d.available}/${d.desired}(미가용 ${d.unavailable})`,
          when: firstAnomaly?.label ?? "최근",
          sourceRef: `deployment/${d.name}`,
        },
        probableCause: d.rollout === "stalled"
          ? "롤아웃 정체 — 새 레플리카 기동 실패 정황(추정)"
          : "롤아웃 진행 중 — 일시 용량 부족(추정)",
        impact: "가용 레플리카 부족으로 용량 저하",
        confidence: "med",
        sourceRefs: [`deployment/${d.name}`, obj.id],
      });
    }
  }

  const signalCount = lines.length;

  // 환각 금지 — 상관 근거가 하나도 없으면 명시적 empty-state.
  if (signalCount === 0) {
    return {
      objectId, found: true, objectType: obj.type, title: obj.title, status: obj.status,
      lines: [],
      rootCauseSummary: `${obj.title}에 상관된 근거가 없습니다.`,
      confidence: "med", signalCount: 0, empty: true, emptyReason: "수집된 이벤트 없음",
    };
  }

  // confidence 규약(단일 출처) — 상관 신호 ≥2 → high. 각 줄과 전체에 동일 규약 적용.
  const confidence: "high" | "med" = signalCount >= 2 ? "high" : "med";
  for (const l of lines) l.confidence = confidence;

  // 정렬(결정적) — kind 우선(firstAnomaly=시간축 앵커를 상단) → id. 신호 detail 은 근거 순서 안정.
  //   firstAnomaly 를 최상단에 두어 "무엇이 먼저 무너졌나" 가 먼저 읽히게 한다(IMP-100 타임라인 앵커).
  const KIND_RANK: Record<EvidenceLine["kind"], number> = {
    firstAnomaly: 0, k8sEvent: 1, k8sPod: 2, k8sDeployment: 3,
    alertrule: 4, throttle: 5, saturation: 6, idleAlloc: 7,
  };
  lines.sort((a, b) => {
    const ra = KIND_RANK[a.kind] ?? 9, rb = KIND_RANK[b.kind] ?? 9;
    if (ra !== rb) return ra - rb;
    return a.id < b.id ? -1 : 1;
  });

  return {
    objectId, found: true, objectType: obj.type, title: obj.title, status: obj.status,
    lines,
    rootCauseSummary: probableCauseText(obj, firstAnomaly, signalCount),
    confidence, signalCount, empty: false,
  };
}

// STATUS_RANK 는 향후 다중 객체 근거 정렬(IMP-93/100)에서 재사용 — 지금은 미사용 방지로 export.
export { STATUS_RANK };
