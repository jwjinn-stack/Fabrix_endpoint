// IMP-68 — /ontology 운영 준비도 스코어카드의 순수 파생 계층.
// docs/ontology-usecase-comparison.md §3·§4 + Datadog Software Catalog Scorecards 패턴:
//   "무슨 타입이 존재하나(browsable 카탈로그)" 대신, 각 인스턴스를 pass/fail 규칙으로 채점해
//   "지금 무엇이 주의를 요하나" 에 답한다. 규칙은 Production Readiness / Observability / Ownership
//   3그룹(Datadog 기본 그룹)으로 묶는다.
//
// ontologySchema.ts(카탈로그·스키마 그래프)의 형제 모듈 — 둘 다 순수(DOM 무관·결정적). 단일 출처
// OntologyObject[](IMP-56 온톨로지 스냅샷, IMP-81 메모이즈)를 받아 스코어를 만든다.
// 스코어는 오직 props/status 에서 파생한다(난수·시각 없음) → 같은 스냅샷이면 항상 같은 결과.

import type { ObjectStatus, ObjectType, OntologyObject } from "./types";

// 채점 대상 타입 — "운영 준비도" 는 운영 인프라 엔티티에만 의미가 있다.
//  Trace(실행 궤적 1건)·Incident(이벤트)는 준비도 대상이 아니라 관측/이벤트 → 채점 제외.
//  (제외해도 스키마 참조 탭의 카탈로그·그래프에는 여전히 등장 = reachable.)
export const SCORABLE_TYPES: ObjectType[] = ["Endpoint", "Model", "GpuDevice", "Node", "Service"];

// 규칙 그룹(Datadog Scorecards 기본 3그룹). 표시 순서 고정(결정적).
export type ScoreGroup = "readiness" | "observability" | "ownership";
export const SCORE_GROUPS: ScoreGroup[] = ["readiness", "observability", "ownership"];
export const GROUP_LABEL: Record<ScoreGroup, string> = {
  readiness: "운영 준비",
  observability: "관측성",
  ownership: "오너십",
};

// 규칙 1건 — id/그룹/라벨 + 적용 타입 판정 + pass 판정(결정적, props/status 만).
interface ScoreRule {
  id: string;
  group: ScoreGroup;
  label: string;              // 화면 표기(사람용)
  failHint: string;           // fail 일 때 "무엇이 없는지" 한 줄(과업 연결 카피)
  applies: (type: ObjectType) => boolean; // 이 타입에 적용되는가
  pass: (obj: OntologyObject) => boolean;  // 통과 판정
}

// props 안전 접근자 — 값이 있고 빈 문자열/0-아님이 아닌지 등. (0 은 "값 있음"으로 취급.)
function has(obj: OntologyObject, key: string): boolean {
  const v = (obj.props as Record<string, unknown>)[key];
  return v != null && v !== "";
}
function num(obj: OntologyObject, key: string): number | undefined {
  const v = (obj.props as Record<string, unknown>)[key];
  return typeof v === "number" ? v : undefined;
}
function bool(obj: OntologyObject, key: string): boolean | undefined {
  const v = (obj.props as Record<string, unknown>)[key];
  return typeof v === "boolean" ? v : undefined;
}

// ── 규칙 정의(결정적) ──────────────────────────────────────────────────────
// 각 규칙은 온톨로지 인스턴스 props/status 에서만 판정한다. Datadog 규칙 예("SLO 있나·모니터 있나·
// on-call 지정·최근 배포")를 우리 도메인(추론 서빙)의 props 로 매핑.
const RULES: ScoreRule[] = [
  // ── Production Readiness (운영 준비) ──
  {
    id: "status-healthy",
    group: "readiness",
    label: "상태 정상",
    failHint: "현재 상태가 위험 — 근본원인 추적이 필요합니다",
    applies: () => true,
    pass: (o) => o.status !== "crit",
  },
  {
    id: "deployed",
    group: "readiness",
    label: "배포/활성",
    failHint: "배포되지 않았거나 활성 상태가 아닙니다",
    applies: () => true,
    pass: (o) => {
      // Endpoint: ready 플래그가 있으면 그 값. Model: replicas>0(서빙 중). 그 외(GpuDevice/Node/Service):
      // 상태가 unknown(미측정)이 아니면 배포/활성으로 본다.
      if (o.type === "Endpoint") {
        const ready = bool(o, "ready");
        return ready ?? o.status !== "unknown";
      }
      if (o.type === "Model") {
        const rep = num(o, "replicas");
        return rep != null ? rep > 0 : o.status !== "unknown";
      }
      return o.status !== "unknown";
    },
  },
  // ── Observability (관측성) ──
  {
    id: "has-telemetry",
    group: "observability",
    label: "텔레메트리 신호",
    failHint: "핵심 메트릭을 emit 하지 않습니다(관측 사각지대)",
    applies: () => true,
    pass: (o) => {
      // 타입별 핵심 메트릭 prop 이 하나라도 있으면 통과.
      const keysByType: Record<ObjectType, string[]> = {
        Endpoint: ["replicas", "backend"],
        Model: ["context_window", "replicas"],
        GpuDevice: ["util_perc", "temp_c"],
        Node: ["cpu_util"],
        Service: ["qps", "error_rate"],
        Trace: [], // 채점 제외 타입 — applies 로 걸리지 않지만 완전성 위해.
        Incident: [],
        Task: [], // PROCESS 층(IMP-69) — 스코어카드 채점 대상 아님(SCORABLE_TYPES 제외).
      };
      return (keysByType[o.type] ?? []).some((k) => has(o, k));
    },
  },
  {
    id: "threshold-signal",
    group: "observability",
    label: "SLO/임계 신호",
    failHint: "임계 판정 가능한 신호(SLO)가 정의돼 있지 않습니다",
    applies: () => true,
    pass: (o) => {
      // 임계(SLO)로 판정 가능한 축이 있는가. Service=error_rate/qps, GPU=temp_c/xid_recent,
      // Endpoint=backend(서빙 경로), Model=pattern(서빙 패턴), Node=cpu_util.
      const keysByType: Record<ObjectType, string[]> = {
        Endpoint: ["backend", "replicas"],
        Model: ["pattern", "gpu"],
        GpuDevice: ["temp_c", "xid_recent"],
        Node: ["cpu_util"],
        Service: ["error_rate", "qps"],
        Trace: [],
        Incident: [],
        Task: [], // PROCESS 층(IMP-69) — 스코어카드 채점 대상 아님.
      };
      return (keysByType[o.type] ?? []).some((k) => has(o, k));
    },
  },
  // ── Ownership (오너십) ──
  {
    id: "has-owner",
    group: "ownership",
    label: "오너 지정",
    failHint: "소유/귀속(앱·부서·호스트·제공자)이 지정돼 있지 않습니다",
    applies: () => true,
    pass: (o) => {
      // 누가 소유·귀속인지 식별 가능한가. Endpoint=app_id||dept_id, Model=provider,
      // GpuDevice/Node=hostname||device, Service=name.
      switch (o.type) {
        case "Endpoint":
          return has(o, "app_id") || has(o, "dept_id");
        case "Model":
          return has(o, "provider");
        case "GpuDevice":
          return has(o, "hostname") || has(o, "device");
        case "Node":
          return has(o, "hostname");
        case "Service":
          return has(o, "name");
        default:
          return false;
      }
    },
  },
];

// 규칙 판정 결과 1건.
export interface RuleResult {
  id: string;
  group: ScoreGroup;
  label: string;
  failHint: string;
  pass: boolean;
}

// 인스턴스 1건의 스코어 — 규칙 결과 + 요약 + at-risk 판정.
export interface InstanceScore {
  object: OntologyObject;
  results: RuleResult[];
  passCount: number;
  failCount: number;
  total: number;
  atRisk: boolean; // status===crit 또는 운영 준비(readiness) 그룹에 fail 이 있음.
}

// 그룹별 집계(전체·인스턴스 공용).
export interface GroupScore {
  group: ScoreGroup;
  pass: number;
  total: number;
}

// "지금 무엇이 주의를 요하나" 요약 — 화면 최상단.
export interface ScorecardSummary {
  scored: number;         // 채점된 인스턴스 수
  atRiskCount: number;    // at-risk 인스턴스 수(주의 요함)
  failingRuleCount: number; // 모든 인스턴스의 fail 규칙 총합
  byGroup: GroupScore[];  // 그룹별 pass/total(전체)
  allPass: boolean;       // scored>0 이고 fail 이 하나도 없음(all-pass 상태)
}

export interface Scorecard {
  instances: InstanceScore[];
  summary: ScorecardSummary;
}

// crit>warn>ok>unknown — 정렬 tie-break 용 status 순위.
const STATUS_RANK: Record<ObjectStatus, number> = { crit: 0, warn: 1, ok: 2, unknown: 3 };

// 인스턴스 1건 채점 — 적용되는 규칙만 평가.
function scoreInstance(obj: OntologyObject): InstanceScore {
  const results: RuleResult[] = RULES.filter((r) => r.applies(obj.type)).map((r) => ({
    id: r.id,
    group: r.group,
    label: r.label,
    failHint: r.failHint,
    pass: r.pass(obj),
  }));
  const passCount = results.filter((r) => r.pass).length;
  const failCount = results.length - passCount;
  // at-risk — 위험 상태이거나, 운영 준비(readiness) 그룹에 fail 이 하나라도 있으면.
  const readinessFail = results.some((r) => r.group === "readiness" && !r.pass);
  const atRisk = obj.status === "crit" || readinessFail;
  return { object: obj, results, passCount, failCount, total: results.length, atRisk };
}

// 스코어카드 파생(순수) — SCORABLE 타입만 채점, at-risk 우선 결정적 정렬.
export function buildScorecard(objects: OntologyObject[]): Scorecard {
  const scorable = objects.filter((o) => SCORABLE_TYPES.includes(o.type));
  const instances = scorable.map(scoreInstance);

  // 정렬(결정적): at-risk 우선 → failCount 내림차순 → status 나쁜 순 → id 사전순.
  instances.sort((a, b) => {
    if (a.atRisk !== b.atRisk) return a.atRisk ? -1 : 1;
    if (a.failCount !== b.failCount) return b.failCount - a.failCount;
    const sr = STATUS_RANK[a.object.status] - STATUS_RANK[b.object.status];
    if (sr !== 0) return sr;
    return a.object.id < b.object.id ? -1 : a.object.id > b.object.id ? 1 : 0;
  });

  // 그룹별 전체 집계.
  const byGroup: GroupScore[] = SCORE_GROUPS.map((group) => {
    let pass = 0;
    let total = 0;
    for (const ins of instances) {
      for (const r of ins.results) {
        if (r.group !== group) continue;
        total += 1;
        if (r.pass) pass += 1;
      }
    }
    return { group, pass, total };
  });

  const atRiskCount = instances.filter((i) => i.atRisk).length;
  const failingRuleCount = instances.reduce((s, i) => s + i.failCount, 0);
  const summary: ScorecardSummary = {
    scored: instances.length,
    atRiskCount,
    failingRuleCount,
    byGroup,
    allPass: instances.length > 0 && failingRuleCount === 0,
  };

  return { instances, summary };
}
