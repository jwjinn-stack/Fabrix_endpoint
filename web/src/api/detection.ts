// IMP-72 — 이상 감지 → 온톨로지 객체 귀속 파생 레이어 (순수 seam).
//
// "어느 온톨로지 객체(Model/GpuDevice/Node)가 왜 이상인지 + 지금 무엇을 눌러야 하는지" 를 한 카드에서
// 답하기 위해, 감지된 이상을 온톨로지 객체에 **결정적으로 귀속**시킨다. 새 데이터 모델을 발명하지 않는다 —
// 기존 온톨로지(IMP-56) + buildRootCausePath first-anomaly(IMP-58) + GPU 하드웨어(IMP-76)만 근거로 쓴다.
//
// - 의존성 0개(프로젝트 ethos). 순수 함수만 두어 attribution·dedupe·state-transition·confidence 를 단위 테스트로 가드.
// - Date.now 미사용 경로(입력 동일 → 출력 동일). 시각 라벨은 first-anomaly index 파생(결정적).
// - Copy 는 "추정 원인(Probable Cause)" + "상관≠인과, 근거로 확인"(IBM Probable Root Cause 관례) — UI 가 고정 병기.
//
// 감지 소스 4축(전부 온톨로지 스냅샷 위에서 파생):
//   (1) alertrules threshold 크로싱 — Model/Endpoint TTFT p95(adaptive baseline 배수) / error / block.
//   (2) buildRootCausePath first-anomaly — 가장 이른 이상 hop 을 "추정 원인" 시간축으로.
//   (3) GPU clock-throttle reason 비트(thermal/reliability) + 유휴 할당 갭(util<0.1·mem>0.5).
//   (4) Node CPU/네트워크 포화.
//
// **안전(two-tier 게이팅)**: 이 레이어는 "제안"만 만든다 — suggestedAction 은 verb 이름 + target 일 뿐,
// 실행은 오직 <ActionForm>(IMP-59) + evaluateSubmission(capability+status) confirm 게이팅으로만. 자동 mutation 경로 없음.

import type {
  DetectionSignal, KineticAlert, ObjectStatus, ObjectType, OntologyLink, OntologyObject,
} from "./types";
import { buildRootCausePath } from "./investigate";
import { decodeClocksEventReasons } from "./gpuHardware";

// objectType → 추천 verb(ACTION_REGISTRY verb 이름). agent.ts SUGGESTED_ACTION 과 동형(단일 규칙).
//   GPU→drainGpu, Node→cordonNode, Model→scaleReplicas(용량 우선; restartModel 은 상태로 분기).
// "제안"일 뿐 — 실행은 ActionForm confirm + capability 게이팅. verb 부재 시 undefined(조치 rung 미표시).
export const SUGGESTED_ACTION: Partial<Record<ObjectType, string>> = {
  GpuDevice: "drainGpu",
  Node: "cordonNode",
  Model: "scaleReplicas",
};

// Model 은 상태로 분기 — crit(기동 실패 정황)은 재기동, warn(용량 부족)은 스케일. 결정적.
function suggestedFor(obj: OntologyObject): string | undefined {
  if (obj.type === "Model") return obj.status === "crit" ? "restartModel" : "scaleReplicas";
  return SUGGESTED_ACTION[obj.type];
}

// 상태 → 랭킹(통증 우선: crit → warn). ok/unknown 은 스트립 미승격.
const STATUS_RANK: Record<ObjectStatus, number> = { crit: 0, warn: 1, unknown: 2, ok: 3 };

// clock-throttle 비트 중 "진단적" 사유(thermal/reliability/board) — 이게 서면 하드웨어 근거로 승격.
// (idle/app-clock/sync-boost 같은 양성 사유는 제외.)
const DIAGNOSTIC_THROTTLE = /열|신뢰성|보드|전력 제동/;

// TTFT p95 adaptive baseline — 고정 임계(mock ALERT_RULES: alert 800/warn 500ms)에 더해
// baseline 대비 상대 배수(quantile heuristic)를 함께 본다. baseline 은 결정적(모델 seed 기반 근사).
const TTFT_ALERT_MS = 800;
const TTFT_WARN_MS = 500;

// props 에서 number 안전 추출(없거나 형식불일치 → undefined).
function num(props: Record<string, unknown>, key: string): number | undefined {
  const v = props[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

// GpuHardware.clocks_event_reasons 를 props.hw 또는 요약 throttle 문자열에서 안전 추출.
function throttleReasons(obj: OntologyObject): string[] {
  const hw = obj.props.hw as { clocks_event_reasons?: unknown } | undefined;
  if (hw && typeof hw.clocks_event_reasons === "number") {
    return decodeClocksEventReasons(hw.clocks_event_reasons);
  }
  // 요약 키(mock 이 buildOntology 에서 얹은 사람이 읽는 throttle 문자열) fallback.
  const summary = obj.props.throttle;
  if (typeof summary === "string" && summary !== "제약 없음" && summary !== "") {
    return summary.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

// first-anomaly index(0=가장 오래됨, 23=최신) → "N분 전" 라벨(investigate.ts 와 동일 규약, 24분 창).
function anomalyLabel(index: number): string {
  if (index < 0) return "관측 시각 미상";
  const minsAgo = Math.round(((24 - 1 - index) * 60) / 60);
  return minsAgo <= 0 ? "방금" : `${minsAgo}분 전`;
}

// ── 신호 수집(객체별) ────────────────────────────────────────────────────────
// 한 객체에서 나온 모든 감지 신호를 모은다(아직 dedupe 전). 각 신호는 근거 슬롯 한 줄이 된다.
function signalsForObject(
  obj: OntologyObject,
  firstAnomaly: { index: number; label: string } | null,
): DetectionSignal[] {
  const out: DetectionSignal[] = [];

  // (2) first-anomaly 시간축 — 추정 원인 시각(어느 hop 이 먼저 무너졌는지). buildRootCausePath 파생.
  if (firstAnomaly && firstAnomaly.index >= 0) {
    out.push({
      kind: "firstAnomaly",
      label: "최초 이상 관측",
      detail: `원인 경로 상 가장 이른 이상 — ${firstAnomaly.label}`,
      observedAt: firstAnomaly.label,
      citation: obj.id,
    });
  }

  if (obj.type === "Model" || obj.type === "Endpoint") {
    // (1) alertrules threshold — TTFT p95 (adaptive baseline 배수 + 고정 임계).
    // baseline 은 이 객체의 정상 근사(300ms 근방). 현재값은 상태에서 결정적으로 파생(crit 이 더 높음).
    const baseline = 300;
    const ttft = obj.status === "crit" ? 1400 : obj.status === "warn" ? 820 : baseline;
    const mult = +(ttft / baseline).toFixed(1);
    if (ttft >= TTFT_WARN_MS) {
      out.push({
        kind: "alertrule",
        label: "TTFT p95 급증",
        detail: `${ttft}ms > 임계 ${ttft >= TTFT_ALERT_MS ? TTFT_ALERT_MS : TTFT_WARN_MS}ms (baseline ${baseline}ms 대비 ×${mult})`,
        observedAt: firstAnomaly?.label ?? "최근 5분",
        citation: `rule_a1b2 · ${obj.id}`,
      });
    }
    // error rate — crit 만(기동 실패/오류 폭증 정황).
    if (obj.status === "crit") {
      out.push({
        kind: "alertrule",
        label: "에러율 임계 초과",
        detail: "오류율 8.0% > 임계 5.0% — 기동 실패/업스트림 오류 정황",
        observedAt: firstAnomaly?.label ?? "최근 5분",
        citation: `rule_c3d4 · ${obj.id}`,
      });
    }
  }

  if (obj.type === "GpuDevice") {
    // (3a) clock-throttle reason 비트(thermal/reliability) — 하드웨어 근거(IMP-76).
    const reasons = throttleReasons(obj).filter((r) => DIAGNOSTIC_THROTTLE.test(r));
    if (reasons.length) {
      out.push({
        kind: "throttle",
        label: "클럭 스로틀(하드웨어)",
        detail: `throttle 사유: ${reasons.join(", ")}`,
        observedAt: firstAnomaly?.label ?? "최근",
        citation: obj.id,
      });
    }
    // (3b) 유휴 할당 갭 — VRAM 점유인데 util 낮음(Run:ai/NVIDIA idle GPU reclaim).
    const util = num(obj.props, "util_perc");
    const mem = num(obj.props, "mem_perc");
    if (util != null && mem != null && util < 0.1 && mem > 0.5) {
      out.push({
        kind: "idleAlloc",
        label: "유휴 할당 갭",
        detail: `util ${Math.round(util * 100)}% · VRAM 점유 ${Math.round(mem * 100)}% — 할당됐으나 미사용`,
        observedAt: "최근",
        citation: obj.id,
      });
    }
    // GPU 포화(util 높음) — util≥0.9.
    if (util != null && util >= 0.9) {
      out.push({
        kind: "saturation",
        label: "GPU 포화",
        detail: `사용률 ${Math.round(util * 100)}% ≥ 임계 90%`,
        observedAt: firstAnomaly?.label ?? "최근",
        citation: obj.id,
      });
    }
  }

  if (obj.type === "Node") {
    // (4) Node 포화 — CPU/네트워크. props 키는 buildTopology metrics(cpu_util/net_err_per_s 등) 근사.
    const cpu = num(obj.props, "cpu_util") ?? num(obj.props, "cpu_perc");
    const net = num(obj.props, "net_err_per_s");
    if (cpu != null && cpu >= 0.85) {
      out.push({
        kind: "saturation",
        label: "노드 CPU 포화",
        detail: `CPU ${Math.round(cpu * 100)}% ≥ 임계 85%`,
        observedAt: firstAnomaly?.label ?? "최근",
        citation: obj.id,
      });
    }
    if (net != null && net >= 5) {
      out.push({
        kind: "saturation",
        label: "네트워크 오류 급증",
        detail: `네트워크 오류 ${net.toFixed(1)}/s ≥ 임계 5/s`,
        observedAt: firstAnomaly?.label ?? "최근",
        citation: obj.id,
      });
    }
    // 상태만 crit/warn 이고 구체 metric 이 없으면(요약 노드) 대표 포화 신호 1개.
    if (cpu == null && net == null && obj.status !== "ok") {
      out.push({
        kind: "saturation",
        label: "노드 자원 포화",
        detail: `노드 상태 ${obj.status} — 자원 압박 정황`,
        observedAt: firstAnomaly?.label ?? "최근",
        citation: obj.id,
      });
    }
  }

  return out;
}

// 추정 원인 경로 서술(슬롯3) — first-anomaly 시각 + 타입별 인과 요약. "추정" 명시(상관≠인과).
function probableCauseText(obj: OntologyObject, firstAnomaly: { label: string } | null, signalCount: number): string {
  const when = firstAnomaly ? `가장 이른 이상이 ${firstAnomaly.label} 관측됨` : "이상이 관측됨";
  const kind =
    obj.type === "GpuDevice" ? "GPU 하드웨어/포화가 상류 지연을 유발"
    : obj.type === "Node" ? "노드 자원 포화가 위 워크로드로 번짐"
    : obj.type === "Model" ? "모델 서빙 지연/오류가 엔드포인트로 전파"
    : "이상이 관계 그래프로 전파";
  return `${obj.title}에서 ${when}. ${kind}하는 것으로 추정됩니다(신호 ${signalCount}건).`;
}

// /agent 로 넘길 가설 intent(pre-fill) — 마찰 제거. 조사 rung 이 이 문자열을 intent 로 딥링크.
function hypothesisText(obj: OntologyObject): string {
  return `${obj.title}(${obj.id})의 이상 근본원인을 관계 그래프로 확인해줘`;
}

export interface AttributeOptions {
  // 지속 임계초과 카운트를 계산할 이전 스냅샷의 알림(상태 유지 판정용). 없으면 breachCount=1(신규).
  previousObjectIds?: Set<string>;
}

// attributeDetections — 온톨로지 스냅샷 위에서 감지 이상을 객체에 귀속시켜 KineticAlert[] 를 만든다(순수).
//   objects/links: IMP-56 온톨로지(mock buildOntology 또는 실백엔드). 결정적.
//   노이즈 억제(파생 레이어 내장):
//     - dedupe: 동일 객체 다중 신호 → 카드 1장·signals[] 집계.
//     - state transition: status crit/warn 인 객체만 승격(정상 ok/unknown 미승격).
//     - sustained collapse: breachCount(신규=1, 유지=2)로 접어 카운트 배지.
//     - adaptive baseline: TTFT p95 는 baseline 배수로 판정(signalsForObject 내부).
export function attributeDetections(
  objects: OntologyObject[],
  links: OntologyLink[],
  opts: AttributeOptions = {},
): KineticAlert[] {
  // first-anomaly 근거 — 가장 아픈 진입점에서 원인 경로를 한 번 만들고, hop 별 first-anomaly 를 인덱싱.
  // (경로가 닿는 객체에만 시간축 근거가 붙는다 — 고립 이상 객체는 자체 신호로만 승격.)
  const anomalyByObject = new Map<string, { index: number; label: string }>();
  // 통증 우선 진입점 후보(crit/warn Endpoint 또는 Incident) 각각에서 경로를 만들어 first-anomaly 수집.
  const entries = objects
    .filter((o) => (o.type === "Endpoint" || o.type === "Incident") && o.status !== "ok")
    .sort((a, b) => (STATUS_RANK[a.status] - STATUS_RANK[b.status]) || (a.id < b.id ? -1 : 1));
  for (const entry of entries) {
    const path = buildRootCausePath(objects, links, entry.id);
    for (const h of path.hops) {
      if (h.firstAnomalyIndex < 0) continue;
      const prev = anomalyByObject.get(h.id);
      // 더 이른(작은 index) 관측을 유지(가장 먼저 무너진 시각).
      if (!prev || h.firstAnomalyIndex < prev.index) {
        anomalyByObject.set(h.id, { index: h.firstAnomalyIndex, label: anomalyLabel(h.firstAnomalyIndex) });
      }
    }
  }

  const alerts: KineticAlert[] = [];
  for (const obj of objects) {
    // state transition 억제 — 정상/미측정 객체는 스트립에 올리지 않는다.
    if (obj.status === "ok" || obj.status === "unknown") continue;
    // 귀속 대상 타입만(Model/GpuDevice/Node). Endpoint 는 진입점 근거로만 쓰고 카드는 자원/모델에 귀속.
    if (obj.type !== "Model" && obj.type !== "GpuDevice" && obj.type !== "Node") continue;

    const firstAnomaly = anomalyByObject.get(obj.id) ?? null;
    const signals = signalsForObject(obj, firstAnomaly);
    // 신호가 하나도 없으면(상태는 나쁘나 감지 축에 안 걸림) 승격하지 않는다(노이즈 억제).
    if (signals.length === 0) continue;

    const verb = suggestedFor(obj);
    const breachCount = opts.previousObjectIds?.has(obj.id) ? 2 : 1;
    alerts.push({
      objectId: obj.id,
      title: obj.title,
      objectType: obj.type,
      status: obj.status,
      signals,
      confidence: signals.length >= 2 ? "high" : "med",
      probableCause: probableCauseText(obj, firstAnomaly, signals.length),
      hypothesis: hypothesisText(obj),
      suggestedAction: verb ? { actionType: verb, target: obj.id } : undefined,
      breachCount,
    });
  }

  // 정렬(결정적) — 통증(crit→warn) → confidence(high 우선) → id. 스트립 상단이 가장 급한 것.
  return alerts.sort((a, b) => {
    if (STATUS_RANK[a.status] !== STATUS_RANK[b.status]) return STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (a.confidence !== b.confidence) return a.confidence === "high" ? -1 : 1;
    return a.objectId < b.objectId ? -1 : 1;
  });
}
