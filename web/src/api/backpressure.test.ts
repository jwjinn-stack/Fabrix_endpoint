// IMP-94 — 스케줄러 backpressure 원인 신호 모델링 테스트.
// 케이스: waiting seed 결정적 파생 / backpressure 클러스터 방출 / SLO 게이팅(waiting>0≠인시던트) /
//         buildIncidentEvidence(IMP-99 seam) 통과 / attributeDetections 승격 / mock 라벨.
import { describe, it, expect } from "vitest";
import { deriveSchedulerSignals } from "./mock";
import { signalsForObject, isBackpressureIncident, attributeDetections } from "./detection";
import { buildIncidentEvidence } from "./incidentEvidence";
import type { OntologyObject, SchedulerSignals } from "./types";

// 게이트 통과 seed(waiting=12 → p95>SLO·지속·ttft 상승) / 짧은 큐 seed(waiting=3 → 미통과).
const HOT = deriveSchedulerSignals(12);
const SHORT = deriveSchedulerSignals(3);

function incident(sched: SchedulerSignals): OntologyObject {
  return {
    id: "incident:inc_seed_q", type: "Incident", title: "대기 큐 적체 — 스케줄러 backpressure",
    props: { dedup_key: "scheduler:queue-backpressure", scheduler: sched }, status: "warn", revision: 1,
  };
}

describe("deriveSchedulerSignals — 결정적 파생(waiting seed 의 고정 함수)", () => {
  it("동일 waiting → 동일 출력(Date.now 미의존)", () => {
    expect(JSON.stringify(deriveSchedulerSignals(12))).toEqual(JSON.stringify(deriveSchedulerSignals(12)));
  });
  it("모든 파생 필드가 waiting 에서 결정적으로 나온다(mock 라벨 포함)", () => {
    expect(HOT.queueDepthTrend[HOT.queueDepthTrend.length - 1]).toBe(12);
    expect(HOT.offeredRate).toBe(HOT.admittedRate + 12); // 유입 = 수용 + 적체
    expect(HOT.offeredRate).toBeGreaterThan(HOT.admittedRate);
    expect(HOT.concurrencyInUse).toBeGreaterThanOrEqual(HOT.concurrencyLimit); // 동시성 포화
    expect(HOT.queueWaitP95).toBeGreaterThan(HOT.queueWaitSlo); // 대기 p95 > SLO
    expect(HOT.source).toBe("mock");
  });
});

describe("SLO 게이팅 — waiting>0 은 자동으로 인시던트가 아니다(증거 규율)", () => {
  it("지속 waiting AND p95>SLO AND ttft 상승 → 게이트 통과", () => {
    expect(isBackpressureIncident(HOT)).toBe(true);
  });
  it("짧은 큐(waiting 작음) → 게이트 미통과(순간 스파이크·정상 버스트)", () => {
    expect(SHORT.waiting).toBeGreaterThan(0);       // waiting>0 이어도
    expect(isBackpressureIncident(SHORT)).toBe(false); // 인시던트 아님
  });
  it("게이트는 bare constant 가 아니라 SLO 임계 대비(p95 ≤ SLO 면 미통과)", () => {
    const belowSlo: SchedulerSignals = { ...HOT, queueWaitP95: HOT.queueWaitSlo, ttftRising: true };
    expect(isBackpressureIncident(belowSlo)).toBe(false);
    const noTtft: SchedulerSignals = { ...HOT, ttftRising: false };
    expect(isBackpressureIncident(noTtft)).toBe(false);
  });
});

describe("signalsForObject — backpressure 클러스터 방출", () => {
  it("게이트 통과 Incident → backpressure 신호 ≥3, 각 신호 citation/observedAt 보유", () => {
    const sigs = signalsForObject(incident(HOT), null);
    const bp = sigs.filter((s) => s.kind === "backpressure");
    expect(bp.length).toBeGreaterThanOrEqual(3);
    for (const s of bp) {
      expect(s.citation).toBeTruthy();
      expect(s.observedAt).toBeTruthy();
      expect(s.detail).toContain("mock"); // mock 라벨 강제
    }
    // 4축(큐깊이 / 유입>수용 / 동시성 / 대기p95) 모두 존재.
    const labels = bp.map((s) => s.label).join(" ");
    expect(labels).toMatch(/큐 깊이/);
    expect(labels).toMatch(/유입/);
    expect(labels).toMatch(/동시성/);
    expect(labels).toMatch(/대기 p95/);
  });
  it("짧은 큐 Incident → 신호 0개(waiting>0≠인시던트)", () => {
    const sigs = signalsForObject(incident(SHORT), null);
    expect(sigs.filter((s) => s.kind === "backpressure")).toHaveLength(0);
  });
  it("scheduler props 없는 Incident → backpressure 신호 없음(graceful)", () => {
    const bare: OntologyObject = { id: "incident:x", type: "Incident", title: "기타", props: {}, status: "warn", revision: 1 };
    expect(signalsForObject(bare, null).filter((s) => s.kind === "backpressure")).toHaveLength(0);
  });
});

describe("buildIncidentEvidence — IMP-99 seam 을 통해 backpressure 근거 인용", () => {
  it("게이트 통과 Incident → backpressure 근거 줄 포함(원인/영향/sourceRefs 채워짐)", () => {
    const ev = buildIncidentEvidence("incident:inc_seed_q", { objects: [incident(HOT)], links: [] });
    expect(ev.found).toBe(true);
    expect(ev.empty).toBe(false);
    const bp = ev.lines.filter((l) => l.kind === "backpressure");
    expect(bp.length).toBeGreaterThanOrEqual(3);
    for (const l of bp) {
      expect(l.probableCause).toBeTruthy();
      expect(l.impact).toBeTruthy();
      expect(l.sourceRefs.length).toBeGreaterThan(0);
    }
    expect(ev.rootCauseSummary).toBeTruthy();
  });
  it("짧은 큐 Incident → backpressure 근거 없음(waiting>0≠인시던트, 게이트 미통과)", () => {
    const ev = buildIncidentEvidence("incident:inc_seed_q", { objects: [incident(SHORT)], links: [] });
    // 큐 근거(backpressure) 는 SLO 게이트를 통과하지 못하면 조립되지 않는다(짧은 큐 = 정상 버스트).
    expect(ev.lines.some((l) => l.kind === "backpressure")).toBe(false);
  });
});

describe("attributeDetections — 게이트 통과 Incident 는 KineticStrip 카드로 승격", () => {
  it("backpressure Incident 승격 + 추천조치 ack(라이프사이클)", () => {
    const alerts = attributeDetections([incident(HOT)], []);
    const card = alerts.find((a) => a.objectId === "incident:inc_seed_q");
    expect(card).toBeDefined();
    expect(card!.signals.some((s) => s.kind === "backpressure")).toBe(true);
    expect(card!.suggestedAction?.actionType).toBe("ack");
    expect(card!.probableCause).toMatch(/유입|수용력|concurrency/);
  });
  it("짧은 큐 Incident 는 미승격(노이즈 억제)", () => {
    const alerts = attributeDetections([incident(SHORT)], []);
    expect(alerts.find((a) => a.objectId === "incident:inc_seed_q")).toBeUndefined();
  });
});
